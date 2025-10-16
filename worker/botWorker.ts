// worker/botWorker.ts
import "dotenv/config";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { ensureTenantActiveOrThrow } from "./enforcement";
import { startOutboxWorker } from "./outboxWorker";

import { Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

import { parseDayLabel, formatHour } from "./utils/dates";
import { getAvailableSlots } from "../src/server/availability";
import { handleReverseFlow, handleRescheduleChoice } from "./flows/reverseFlow";
// ⬇️ FIX: evitar alias @ en el worker
import { detectIntentBasic } from "../src/server/intents";
import { scheduleDailyReminders, startRemindersWorker } from "./reminders";

// ---------- ENV ----------
const REDIS_URL = process.env.REDIS_URL!;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const MOCK_AI = process.env.MOCK_AI === "true";

if (!REDIS_URL) throw new Error("Falta REDIS_URL");
if (!SUPABASE_URL) throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL");
if (!SUPABASE_SERVICE_ROLE) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");

// ---------- CLIENTES ----------
const useTls = REDIS_URL.startsWith("rediss://");
const connection = new IORedis(REDIS_URL, {
  tls: useTls ? {} : undefined,
  family: 4,
  connectTimeout: 20000,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times) {
    return Math.min(1000 * Math.pow(2, times), 10000);
  },
});
connection.on("error", (e) => console.error("[redis error]", e?.message));

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

// Instancia OpenAI sólo si aplica
let openai: OpenAI | null = null;
if (!MOCK_AI) {
  if (!OPENAI_API_KEY) {
    console.warn("⚠️  OPENAI_API_KEY ausente. Forzando modo demo (sin OpenAI).");
  } else {
    openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  }
}

// >>> NUEVO: utilidades de plantillas (render + defaults + fetch desde DB)
function renderTemplate(body: string, vars: Record<string, string>) {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] ?? ""));
}

const DEFAULT_TEMPLATES: Record<string, string> = {
  payment_required:
    "⚠️ Servicio temporalmente bloqueado por suscripción vencida. Paga aquí para reactivar: {{payment_link}}",
  booking_confirmed:
    "✅ {{customer_name}}, tu cita quedó para {{date}} a las {{time}} con {{resource_name}}.",
  booking_rescheduled:
    "🔁 {{customer_name}}, reprogramamos tu cita para {{date}} a las {{time}} con {{resource_name}}.",
  booking_cancelled:
    "🗓️ {{customer_name}}, tu cita con {{resource_name}} fue cancelada.",
  reminder:
    "⏰ Recordatorio: {{customer_name}}, te esperamos el {{date}} a las {{time}} con {{resource_name}}.",
};

async function getTemplateOrDefault(
  tenantId: string,
  channel: "whatsapp" | "sms" | "email",
  event:
    | "payment_required"
    | "booking_confirmed"
    | "booking_rescheduled"
    | "booking_cancelled"
    | "reminder"
): Promise<string> {
  try {
    const { data, error } = await supabase
      .from("message_templates")
      .select("body")
      .eq("tenant_id", tenantId)
      .eq("channel", channel)
      .eq("event", event)
      .eq("active", true)
      .maybeSingle();

    if (error) console.error("[message_templates] error:", error);
    return data?.body || DEFAULT_TEMPLATES[event] || "";
  } catch (e) {
    console.error("[getTemplateOrDefault] error:", e);
    return DEFAULT_TEMPLATES[event] || "";
  }
}

// >>> NUEVO: helper de “gating” pago
async function sendPaymentRequired(tenantId: string, conversationId: string, toPhone: string) {
  const tpl = await getTemplateOrDefault(tenantId, "whatsapp", "payment_required");
  let paymentLink = "https://tu-dominio.com/billing";
  try {
    const { data: st } = await supabase
      .from("settings")
      .select("payment_link")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (st?.payment_link) paymentLink = st.payment_link;
  } catch (e) {
    console.warn("[settings.payment_link] fallback");
  }

  const text = renderTemplate(tpl, {
    payment_link: paymentLink,
    customer_name: "",
    date: "",
    time: "",
    resource_name: "",
  });

  await supabase.from("messages").insert({
    conversation_id: conversationId,
    role: "assistant",
    content: text,
  });

  try {
    const { sendViaTwilio } = await import("./utils/sendViaTwilio");
    await sendViaTwilio(toPhone, text);
  } catch (e: any) {
    console.error("[Twilio payment_required] error:", e?.message || e);
    const msg = String(e?.message || "");
    if (msg.includes("429") || msg.toLowerCase().includes("rate")) {
      try {
        await supabase.from("outbox").insert({
          tenant_id: tenantId,
          channel: "whatsapp",
          to: toPhone,
          body: text,
          event: "payment_required",
          status: "pending",
          retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        });
      } catch (ee) {
        console.error("[outbox insert payment_required] error:", ee);
      }
    }
  }
}

// ---------- HELPERS ----------
async function replyAndMaybeTwilio(conversationId: string, text: string): Promise<void> {
  await supabase.from("messages").insert({
    conversation_id: conversationId,
    role: "assistant",
    content: text,
  });
  try {
    const { data: conv } = await supabase
      .from("conversations")
      .select("phone")
      .eq("id", conversationId)
      .maybeSingle();
    if (conv?.phone) {
      const { sendViaTwilio } = await import("./utils/sendViaTwilio");
      await sendViaTwilio(conv.phone, text);
    }
  } catch (e) {
    console.error("[Twilio] error:", e);

    // >>> NUEVO: encolar en outbox si hay rate-limit 429
    try {
      const msg = String((e as any)?.message || "");
      if (msg.includes("429") || msg.toLowerCase().includes("rate")) {
        const { data: conv2 } = await supabase
          .from("conversations")
          .select("tenant_id, phone")
          .eq("id", conversationId)
          .maybeSingle();
        if (conv2?.tenant_id && conv2?.phone) {
          await supabase.from("outbox").insert({
            tenant_id: conv2.tenant_id,
            channel: "whatsapp",
            to: conv2.phone,
            body: text,
            event: "generic",
            status: "pending",
            retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          });
        }
      }
    } catch (ee) {
      console.error("[outbox insert generic] error:", ee);
    }
  }
}

async function firstServiceForTenant(tenantId: string) {
  const { data: svc, error } = await supabase
    .from("services")
    .select("id, name, duration_min, buffer_after_min, duration_minutes, buffer_minutes")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) console.error("[services] error:", error);
  return svc;
}

function toInt(s: string): number | null {
  const n = Number(String(s || "").trim());
  return Number.isInteger(n) ? n : null;
}

function formatDateEsDO(d: Date) {
  try {
    return new Intl.DateTimeFormat("es-DO", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "America/Santo_Domingo",
    }).format(d);
  } catch {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${day}/${m}/${y}`;
  }
}

/** Calcula "medianoche local RD" expresada en UTC para una fecha dada. */
const RD_OFFSET_MIN = 240;
function rdLocalMidnightAsUTC(d: Date): Date {
  const y = d.getFullYear();
  const m = d.getMonth(); // 0-based
  const day = d.getDate();
  const ms = Date.UTC(y, m, day, 0, 0, 0, 0) + RD_OFFSET_MIN * 60 * 1000;
  return new Date(ms);
}

/** Busy por día y recurso, considerando solape real y estados que bloquean. */
async function getBusyForDay(opts: {
  tenantId: string;
  resourceIds: string[];
  dayStartUTC: Date;
}) {
  const { tenantId, resourceIds, dayStartUTC } = opts;
  const dayEndUTC = new Date(dayStartUTC.getTime() + 24 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from("bookings")
    .select("resource_id, starts_at, ends_at, status")
    .eq("tenant_id", tenantId)
    .in("resource_id", resourceIds)
    .lt("starts_at", dayEndUTC.toISOString())
    .gt("ends_at", dayStartUTC.toISOString())
    .in("status", ["confirmed", "rescheduled"]);

  if (error) {
    console.error("[getBusyForDay] error:", error);
    return [];
  }
  return data ?? [];
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

// === NUEVO: formateador de hora RD con “a. m./p. m.” ===
const hourFmtRD = new Intl.DateTimeFormat("es-DO", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
  timeZone: "America/Santo_Domingo",
});

/**
 * Garantiza fila en conversation_state con tenant_id.
 */
async function ensureConversationState(conversationId: string) {
  const { data: state, error: selErr } = await supabase
    .from("conversation_state")
    .select("conversation_id, tenant_id, stage, pending_slots, pending_service_id, updated_at")
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (selErr) console.error("[conversation_state.select] error:", selErr);

  let tenantId = state?.tenant_id as string | undefined;

  if (!tenantId) {
    const { data: conv, error: convErr } = await supabase
      .from("conversations")
      .select("tenant_id")
      .eq("id", conversationId)
      .maybeSingle();
    if (convErr) console.error("[conversations.select tenant_id] error:", convErr);
    tenantId = (conv?.tenant_id as string | undefined) || tenantId;
  }

  if (!state) {
    const { error: insErr } = await supabase.from("conversation_state").insert({
      conversation_id: conversationId,
      tenant_id: tenantId ?? null,
      stage: "awaiting_day",
      pending_slots: null,
      pending_service_id: null,
      updated_at: new Date().toISOString(),
    });
    if (insErr) console.error("[conversation_state.insert] error:", insErr);
    return {
      stage: "awaiting_day",
      tenant_id: tenantId,
      pending_slots: null as any,
      pending_service_id: null as any,
    };
  }

  if (!state.tenant_id && tenantId) {
    await supabase
      .from("conversation_state")
      .update({
        tenant_id: tenantId,
        updated_at: new Date().toISOString(),
      })
      .eq("conversation_id", conversationId);
  }

  return {
    stage: state.stage ?? "awaiting_day",
    tenant_id: tenantId,
    pending_slots: (state.pending_slots as any[]) ?? [],
    pending_service_id: state.pending_service_id as string | undefined,
  };
}

async function listSlotsAndAdvance(
  conversationId: string,
  tenantId: string,
  day: Date
): Promise<boolean> {
  const svc = await firstServiceForTenant(tenantId);
  if (!svc?.id) {
    await replyAndMaybeTwilio(
      conversationId,
      "Aún no tengo servicios configurados. Agrega uno y lo intento de nuevo."
    );
    return true;
  }

  try {
    // Pedimos la fecha como 'medianoche local RD' en UTC
    const dayUTC = rdLocalMidnightAsUTC(day);

    // Slots base (ya excluye 'confirmed')
    const slots = await getAvailableSlots({
      supabase,
      tenantId,
      serviceId: svc.id,
      date: dayUTC,
      maxSlots: 24,
    });

    if (!slots.length) {
      await replyAndMaybeTwilio(conversationId, "Ese día estoy full. ¿Probamos otro día?");
      return true;
    }

    // Filtrar también contra 'rescheduled' + solape real
    const resourceIds = Array.from(new Set(slots.map((s) => s.resource_id)));
    const busy = await getBusyForDay({
      tenantId,
      resourceIds,
      dayStartUTC: dayUTC,
    });

    const slotsKept = slots.filter((s) => {
      const sStart = s.start instanceof Date ? s.start : new Date(s.start);
      const sEnd = s.end instanceof Date ? s.end : new Date(s.end);
      const clashes = busy.some(
        (b) => b.resource_id === s.resource_id && overlaps(sStart, sEnd, new Date(b.starts_at), new Date(b.ends_at))
      );
      return !clashes;
    });

    if (!slotsKept.length) {
      await replyAndMaybeTwilio(conversationId, "Ese día no me quedan horarios libres. Probemos otro día.");
      return true;
    }

    // === NUEVO: mostrar hasta 12 opciones con AM/PM RD ===
    const MAX_OPTS = 12;
    const list = slotsKept
      .slice(0, MAX_OPTS)
      .map((s, i) => `${i + 1}) ${hourFmtRD.format(new Date(s.start))} con ${s.resource_name}`)
      .join("\n");

    await supabase
      .from("conversation_state")
      .update({
        stage: "awaiting_slot",
        pending_slots: slotsKept.slice(0, MAX_OPTS).map((s) => ({
          start: s.start.toISOString(),
          end: s.end.toISOString(),
          resource_id: s.resource_id,
          resource_name: s.resource_name,
          service_id: svc.id,
        })),
        pending_service_id: svc.id,
        updated_at: new Date().toISOString(),
      })
      .eq("conversation_id", conversationId);

    await replyAndMaybeTwilio(
      conversationId,
      `Para ese día tengo:\n${list}\n\nElige un número (1-${Math.min(MAX_OPTS, slotsKept.length)}).`
    );

    return true;
  } catch (e) {
    console.error("[availability] error:", e);
    await replyAndMaybeTwilio(
      conversationId,
      "Tuve un problema calculando los horarios. ¿Puedes intentar con otro día?"
    );
    return true;
  }
}

// ---------- LÓGICA ----------
async function handleUserMessage(job: Job) {
  const { conversationId, text } = job.data as { conversationId: string; text: string };

  // 0) Asegurar estado y tenant
  const ensured = await ensureConversationState(conversationId);
  const currentStage = ensured.stage ?? "awaiting_day";
  const tenantId = ensured.tenant_id as string | undefined;
  const pendingSlots = ((ensured.pending_slots as any[]) ?? []) as Array<{
    start: string;
    end: string;
    resource_id: string;
    resource_name: string;
    service_id?: string;
  }>;
  const pendingServiceId = ensured.pending_service_id as string | undefined;

  // obtener teléfono del cliente
  const { data: convRow } = await supabase
    .from("conversations")
    .select("phone")
    .eq("id", conversationId)
    .maybeSingle();
  const phone = convRow?.phone ?? "";

  console.log("[worker] stage=", currentStage, "tenantId=", tenantId, "text=", JSON.stringify(text));

  // >>> NUEVO: enforcement global al inicio del manejo de mensaje
  if (tenantId) {
    try {
      await ensureTenantActiveOrThrow(tenantId);
    } catch (e) {
      await sendPaymentRequired(tenantId, conversationId, phone);
      return;
    }
  }

  // === NLP rápido: cancelar / reprogramar ===
  if (tenantId) {
    const quickIntent = await detectIntentBasic(text, tenantId);

    // Si el usuario pide cancelar/reprogramar, delega flujo inverso
    if (quickIntent === "cancel" || quickIntent === "reschedule") {
      const handled = await handleReverseFlow(tenantId, phone, text);
      if (handled) return;
    }

    // ⬇️ Si envía un número y NO estamos en reserva normal, trátalo como re-agenda
    if (/^\d+$/.test(text.trim())) {
      const n = parseInt(text.trim(), 10);
      if (currentStage !== "awaiting_slot") {
        await handleRescheduleChoice(tenantId, phone, n);
        return;
      }
    }
  }
  // === FIN NLP rápido ===

  // 🔁 Detección de día (PRIORIDAD)
  const detectedDay = parseDayLabel(text);
  if (detectedDay) {
    if (!tenantId) {
      await replyAndMaybeTwilio(conversationId, "No tengo asociado el negocio a esta conversación todavía.");
      return;
    }

    // ✅ Chequeo “cita el mismo día” usando medianoche RD → UTC
    const dayUTC = rdLocalMidnightAsUTC(detectedDay);
    const dayEndUTC = new Date(dayUTC.getTime() + 24 * 60 * 60 * 1000);

    const { data: existingSameDay, error: exErr } = await supabase
      .from("bookings")
      .select("id, starts_at, resource_id")
      .eq("tenant_id", tenantId)
      .eq("customer_phone", phone)
      .in("status", ["confirmed", "rescheduled"])
      .gte("starts_at", dayUTC.toISOString())
      .lt("starts_at", dayEndUTC.toISOString())
      .order("starts_at", { ascending: true })
      .limit(1);

    if (exErr) console.error("[existingSameDay] error:", exErr);

    if (existingSameDay?.length) {
      // traer nombre del recurso
      let resourceName = "el especialista";
      if (existingSameDay[0].resource_id) {
        const { data: r } = await supabase
          .from("resources")
          .select("name")
          .eq("id", existingSameDay[0].resource_id)
          .maybeSingle();
        if (r?.name) resourceName = r.name;
      }
      const hora = new Date(existingSameDay[0].starts_at);
      await replyAndMaybeTwilio(
        conversationId,
        `Ya tienes una cita ese día a las ${formatHour(hora)} con ${resourceName}. ` +
          `¿Quieres **reprogramar** o **cancelar**?`
      );
      return;
    }

    const handled = await listSlotsAndAdvance(conversationId, tenantId, detectedDay);
    if (handled) return;
  }

  // 1) Si seguimos esperando día
  if (currentStage === "awaiting_day") {
    if (!tenantId) {
      await replyAndMaybeTwilio(conversationId, "No tengo asociado el negocio a esta conversación todavía.");
      return;
    }
    await replyAndMaybeTwilio(
      conversationId,
      'Dime "hoy", "mañana" o una fecha (2025-10-09 o 09/10/2025).'
    );
    return;
  }

  // 2) Esperando selección de horario (RESERVA)
  if (currentStage === "awaiting_slot") {
    const n = toInt(text);
    if (!n || n < 1 || n > pendingSlots.length) {
      await replyAndMaybeTwilio(conversationId, `Dime un número válido (1-${Math.max(1, pendingSlots.length)}).`);
      return;
    }

    const chosen = pendingSlots[n - 1];
    const startsAt = new Date(chosen.start);
    const endsAt = new Date(chosen.end);
    
    const resourceId = chosen.resource_id;
    const serviceId = chosen.service_id || pendingServiceId;

    if (!tenantId || !serviceId || !resourceId) {
      await replyAndMaybeTwilio(
        conversationId,
        "No logré identificar el servicio o recurso para la reserva. Pide horarios otra vez, por favor."
      );
      await supabase
        .from("conversation_state")
        .update({
          stage: "awaiting_day",
          pending_slots: null,
          pending_service_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq("conversation_id", conversationId);
      return;
    }

    // --- cuota demo: 30/mes ---
    try {
      const now = new Date();
      const y = now.getUTCFullYear();
      const m = now.getUTCMonth() + 1;

      const { data: sub } = await supabase
        .from("subscriptions")
        .select("plan")
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (!sub || sub.plan === "demo") {
        const { data: usage } = await supabase
          .from("usage_counters")
          .select("bookings_created")
          .eq("tenant_id", tenantId)
          .eq("y", y)
          .eq("m", m)
          .maybeSingle();

        const count = usage?.bookings_created ?? 0;
        if (count >= 30) {
          await replyAndMaybeTwilio(
            conversationId,
            "Alcanzaste el límite de 30 citas del plan Demo este mes. Escríbenos para activar el plan Pro ✨"
          );
          return;
        }
      }
    } catch (e) {
      console.error("[quota check] error:", e);
    }

    // ======= RESERVA usando RPC (Opción 1) =======
    try {
      const { data, error } = await supabase.rpc("book_slot_safe_phone", {
        p_tenant: tenantId,
        p_phone: phone,
        p_service: serviceId,
        p_resource: resourceId,
        p_starts: startsAt.toISOString(),
        p_ends: endsAt.toISOString(),
        p_customer_name: "Cliente",
        p_notes: null,
      });

      if (error) {
        console.error("[rpc book_slot_safe_phone] error:", error);
        await replyAndMaybeTwilio(conversationId, "Hubo un problema creando la cita. Intenta otro horario.");
        return;
      }

      const result = data?.result as string | undefined;

      if (result === "CREATED") {
        // limpiar estado
        await supabase
          .from("conversation_state")
          .update({
            stage: "idle",
            pending_slots: null,
            pending_service_id: null,
            updated_at: new Date().toISOString(),
          })
          .eq("conversation_id", conversationId);

        const reply =
          `¡Listo! Te agendé el ${formatDateEsDO(startsAt)} a las ${formatHour(startsAt)} ` +
          `con ${chosen.resource_name}.`;
        await replyAndMaybeTwilio(conversationId, reply);
        return;
      }

      if (result === "EXISTS_SAME_DAY") {
        const when = new Date(data.booking.starts_at);
        await replyAndMaybeTwilio(
          conversationId,
          `Ya tienes una reserva ese día a las ${formatHour(when)}. ` +
            `Si deseas *reprogramar* o *cancelar*, dímelo y lo hago.`
        );
        return;
      }

      if (result === "CONFLICT_SLOT") {
        // re-listar opciones actualizadas
        const sameDayUTC = rdLocalMidnightAsUTC(startsAt);
        const fresh = await getAvailableSlots({
          supabase,
          tenantId,
          serviceId,
          date: sameDayUTC,
          maxSlots: 24,
        });

        if (!fresh.length) {
          await supabase
            .from("conversation_state")
            .update({
              stage: "awaiting_day",
              pending_slots: null,
              pending_service_id: null,
              updated_at: new Date().toISOString(),
            })
            .eq("conversation_id", conversationId);

          await replyAndMaybeTwilio(
            conversationId,
            "Ese horario se ocupó y no me quedan cupos ese día. Dime otro día y te muestro opciones."
          );
          return;
        }

        // aplicar el mismo filtro contra 'busy' (confirmed + rescheduled)
        const resourceIds = Array.from(new Set(fresh.map((s) => s.resource_id)));
        const busy = await getBusyForDay({
          tenantId,
          resourceIds,
          dayStartUTC: rdLocalMidnightAsUTC(startsAt),
        });

        const kept = fresh.filter((s) => {
          const sStart = s.start instanceof Date ? s.start : new Date(s.start);
          const sEnd = s.end instanceof Date ? s.end : new Date(s.end);
          return !busy.some(
            (b) => b.resource_id === s.resource_id && overlaps(sStart, sEnd, new Date(b.starts_at), new Date(b.ends_at))
          );
        });

        // === NUEVO: limitar y formatear igual que arriba
        const MAX_OPTS = 12;
        await supabase
          .from("conversation_state")
          .update({
            stage: "awaiting_slot",
            pending_slots: kept.slice(0, MAX_OPTS).map((s) => ({
              start: s.start.toISOString(),
              end: s.end.toISOString(),
              resource_id: s.resource_id,
              resource_name: s.resource_name,
              service_id: serviceId,
            })),
            pending_service_id: serviceId,
            updated_at: new Date().toISOString(),
          })
          .eq("conversation_id", conversationId);

        const list = kept
          .slice(0, MAX_OPTS)
          .map((s, i) => `${i + 1}) ${hourFmtRD.format(new Date(s.start))} con ${s.resource_name}`)
          .join("\n");

        await replyAndMaybeTwilio(
          conversationId,
          `Ese horario se ocupó. Me quedan:\n${list}\n\nElige un número (1-${Math.min(MAX_OPTS, kept.length)}).`
        );
        return;
      }

      // Si el RPC devolvió un error genérico
      if (result === "ERROR") {
        const detail = data?.detail ? ` Detalle: ${data.detail}` : "";
        await replyAndMaybeTwilio(conversationId, "No pude crear la cita." + detail);
        return;
      }

      // Fallback
      await replyAndMaybeTwilio(conversationId, "No pude crear la cita. Probemos de nuevo.");
      return;
    } catch (e) {
      console.error("[reserve via RPC] error:", e);
      await replyAndMaybeTwilio(conversationId, "Se me cruzó un error creando la cita. Intenta otro horario.");
      return;
    }
  }

  // 3) Fallback general (demo / OpenAI)
  try {
    const { data: history, error: histErr } = await supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(20);

    if (histErr) console.error("[history] error:", histErr);

    let reply = "";

    if (MOCK_AI || !openai) {
      reply = `🤖 (demo) Me dijiste: "${text}"`;
    } else {
      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: "Eres un asistente útil y directo. Responde en español." },
        ...(history ?? []).map((m: any) => ({ role: m.role, content: m.content })),
        { role: "user", content: text },
      ];

      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages,
          temperature: 0.4,
        });

        reply = completion.choices?.[0]?.message?.content?.trim() ?? "No pude generar respuesta ahora mismo.";
      } catch (err: any) {
        const status = err?.status ?? err?.response?.status;
        if (status === 429) throw new Error("OpenAI 429: retry");
        console.error("[OpenAI] error:", err?.message || err);
        reply = "Estoy un poco ocupado ahora mismo. Intentaré responder en breve.";
      }
    }

    const { error: insErr } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: reply,
    });
    if (insErr) console.error("[messages.insert assistant] error:", insErr);

    try {
      const { data: conv, error: convErr } = await supabase
        .from("conversations")
        .select("phone")
        .eq("id", conversationId)
        .maybeSingle();

      if (convErr) {
        console.error("[conversations.select phone] error:", convErr);
      } else if (conv?.phone) {
        const { sendViaTwilio } = await import("./utils/sendViaTwilio");
        await sendViaTwilio(conv.phone, reply);
      }
    } catch (e) {
      console.error("[Twilio wrapper] error:", e);
    }
  } catch (e) {
    console.error("[handleUserMessage] error:", e);
  }
}

// ---------- WORKER ----------
const worker = new Worker(
  "chat-queue",
  async (job) => {
    if (job.name === "user-message") {
      await handleUserMessage(job);
    }
  },
  { connection }
);

worker.on("completed", (job) => console.log(`✅ job ${job.id} completed`));
worker.on("failed", (job, err) => console.error(`❌ job ${job?.id} failed:`, err?.message));

// Recordatorios
startRemindersWorker();
scheduleDailyReminders().catch((e) => console.error("[scheduleDailyReminders] error:", e));
// Outbox retries
startOutboxWorker();

console.log(`✅ Bot worker corriendo${MOCK_AI || !openai ? " en modo demo (sin OpenAI)" : " (OpenAI activo)"}…`);
