// worker/flows/reverseFlow.ts
import { createClient } from "@supabase/supabase-js";
import { getAvailableSlots } from "../../src/server/availability";
import { detectIntentBasic } from "../../src/server/intents";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ======================
// Zona horaria (RD -4h)
// ======================
const RD_OFFSET_MIN = 240; // minutos

/**
 * A partir de un starts_at (UTC) de la cita, calcula la medianoche LOCAL RD
 * y la expresa en UTC. Sirve para consultar todos los slots de ese día.
 */
function bookingLocalMidnightAsUTC(startsAtISO: string): Date {
  const startsUTC = new Date(startsAtISO);
  // convertir a hora local RD restando el offset
  const local = new Date(startsUTC.getTime() - RD_OFFSET_MIN * 60 * 1000);
  // construir medianoche LOCAL (Y-M-D 00:00) y proyectarla a UTC sumando el offset
  const dayUTCms =
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
      0, 0, 0, 0
    ) + RD_OFFSET_MIN * 60 * 1000;
  return new Date(dayUTCms);
}

/** Devuelve el fin de día (medianoche del día siguiente) a partir de un inicio de día UTC. */
function endOfDayUTC(dayStartUTC: Date): Date {
  const d = new Date(dayStartUTC);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

// ======================
// Helpers generales
// ======================

// Normaliza el teléfono: quita "whatsapp:", espacios y símbolos (excepto '+')
function normalizePhone(p: string): string {
  const s = (p || "").toLowerCase().replace(/^whatsapp:/, "").trim();
  return s.replace(/[^0-9+]/g, "");
}

const toMinute = (t: number) => Math.floor(t / 60000);
/** Igualdad robusta de inicio (tolera milisegundos/segundos) */
function sameStartWithin(aMs: number, bMs: number, tolMs = 60_000): boolean {
  return Math.abs(aMs - bMs) < tolMs;
}
/** Solape estricto (Date) */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

/** Medianoche LOCAL RD de *hoy* expresada en UTC */
function todayLocalMidnightAsUTC(): Date {
  const now = new Date();
  // pasar NOW UTC → LOCAL RD
  const local = new Date(now.getTime() - RD_OFFSET_MIN * 60 * 1000);
  // construir medianoche local y proyectar a UTC
  const dayUTCms =
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
      0, 0, 0, 0
    ) + RD_OFFSET_MIN * 60 * 1000;
  return new Date(dayUTCms);
}

// === formateador de hora RD con “a. m./p. m.” ===
const hourFmtRD = new Intl.DateTimeFormat("es-DO", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
  timeZone: "America/Santo_Domingo",
});

// ======================
// Acceso a Bookings (lookup certero por teléfono + tiempo)
// ======================
async function getActiveBooking(tenantId: string, phone: string) {
  const nowIso = new Date().toISOString();

  // Ventana del día local RD (por si la cita ya inició o está por iniciar)
  const todayStartUTC = todayLocalMidnightAsUTC();
  const todayEndUTC = endOfDayUTC(todayStartUTC);

  // 1) Intento por phone_norm (si existe)
  const norm = normalizePhone(phone);
  try {
    // a) Próxima u “en curso”: ENDS_AT >= NOW (más robusto que starts_at)
    const q1 = await sb
      .from("bookings")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("phone_norm", norm)
      .in("status", ["confirmed", "rescheduled"])
      .gte("ends_at", nowIso)                // 👈 clave: aún no terminó
      .order("starts_at", { ascending: true })
      .limit(1);
    if (!q1.error && q1.data && q1.data.length) return q1.data[0];

    // b) Fallback: cualquier cita de HOY (local RD)
    const q2 = await sb
      .from("bookings")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("phone_norm", norm)
      .in("status", ["confirmed", "rescheduled"])
      .gte("starts_at", todayStartUTC.toISOString())
      .lt("starts_at", todayEndUTC.toISOString())
      .order("starts_at", { ascending: true })
      .limit(1);
    if (!q2.error && q2.data && q2.data.length) return q2.data[0];
  } catch (e) {
    console.warn("[getActiveBooking] phone_norm lookup fallback:", (e as any)?.message);
  }

  // 2) Fallback por variantes del teléfono si no hay phone_norm
  const noProto = phone.replace(/^whatsapp:/i, "").trim();
  const noSpaces = noProto.replace(/\s+/g, "");
  const noPlus = noSpaces.replace(/^\+/, "");
  const withPlus = noSpaces.startsWith("+") ? noSpaces : `+${noSpaces}`;
  const candidates = Array.from(new Set([phone, noProto, noSpaces, noPlus, withPlus])).filter(Boolean);

  // a) ENDS_AT >= NOW
  const q3 = await sb
    .from("bookings")
    .select("*")
    .eq("tenant_id", tenantId)
    .in("customer_phone", candidates)
    .in("status", ["confirmed", "rescheduled"])
    .gte("ends_at", nowIso)
    .order("starts_at", { ascending: true })
    .limit(1);
  if (q3.data && q3.data.length) return q3.data[0];

  // b) Fallback: HOY (local RD)
  const q4 = await sb
    .from("bookings")
    .select("*")
    .eq("tenant_id", tenantId)
    .in("customer_phone", candidates)
    .in("status", ["confirmed", "rescheduled"])
    .gte("starts_at", todayStartUTC.toISOString())
    .lt("starts_at", todayEndUTC.toISOString())
    .order("starts_at", { ascending: true })
    .limit(1);
  return q4.data?.[0] ?? null;
}

/**
 * Devuelve todas las reservas que ocupan agenda para el mismo recurso
 * que se SOLAPEN con el día [dayStartUTC, dayEndUTC).
 * Excluye opcionalmente una booking por id para no interferir en el filtro.
 */
async function getBusyForDay(options: {
  tenantId: string;
  resourceId: string;
  dayStartUTC: Date;
  excludeBookingId?: string;
}) {
  const { tenantId, resourceId, dayStartUTC, excludeBookingId } = options;
  const dayEndUTC = endOfDayUTC(dayStartUTC);

  let query = sb
    .from("bookings")
    .select("id, starts_at, ends_at")
    .eq("tenant_id", tenantId)
    .eq("resource_id", resourceId)
    .in("status", ["confirmed", "rescheduled"])
    .lt("starts_at", dayEndUTC.toISOString())
    .gt("ends_at", dayStartUTC.toISOString());

  if (excludeBookingId) query = query.neq("id", excludeBookingId);

  const { data, error } = await query;
  if (error) console.error("[getBusyForDay] error:", error);
  return data ?? [];
}

// ======================
// Envío WhatsApp
// ======================
async function sendWhatsApp(to: string, text: string): Promise<boolean> {
  const DRY = process.env.TWILIO_DRY_RUN === "true"; // para pruebas locales
  if (DRY) {
    console.log(`[WA][dry-run] -> ${to}: ${text}`);
    return true;
  }
  try {
    const { sendViaTwilio } = await import("../utils/sendViaTwilio");
    await sendViaTwilio(to, text);
    return true;
  } catch (e: any) {
    const code = e?.code ?? e?.status;
    const isRateLimit = code === 63038 || e?.status === 429;
    if (isRateLimit) {
      console.warn("[Twilio limit] 63038/429: superado el tope diario. Guardando en outbox y continuando…");
      try {
        await sb.from("outbox").insert({
          channel: "whatsapp",
          to,
          payload: { text },
          reason: "twilio_rate_limit",
          created_at: new Date().toISOString(),
        });
      } catch (outboxErr) {
        console.error("[outbox insert error]", outboxErr);
      }
      return false;
    }
    console.error("[sendWhatsApp] error:", e);
    return false;
  }
}

// ======================
// Flujo Reverse (cancel / reschedule)
// ======================
export async function handleReverseFlow(
  tenantId: string,
  phone: string,
  text: string
) {
  const intent = await detectIntentBasic(text, tenantId);

  if (intent === "cancel") {
    const bk = await getActiveBooking(tenantId, phone);
    if (!bk) {
      await sendWhatsApp(phone, "No encontré una cita activa para cancelar 🙏");
      return true;
    }
    await sb.from("bookings").update({ status: "cancelled" }).eq("id", bk.id);
    await sendWhatsApp(phone, "✅ Tu cita fue cancelada. ¿Quieres agendar otra?");
    return true;
  }

  if (intent === "reschedule") {
    const bk = await getActiveBooking(tenantId, phone);
    if (!bk) {
      await sendWhatsApp(phone, "No veo una cita activa para mover. ¿Deseas crear una nueva?");
      return true;
    }

    // Día correcto (medianoche local RD expresada en UTC)
    const dayUTC = bookingLocalMidnightAsUTC(bk.starts_at);

    // Marcar temporalmente como 'rescheduled' para no bloquear disponibilidad
    await sb.from("bookings").update({ status: "rescheduled" }).eq("id", bk.id);

    // Traer TODOS los slots del MISMO día (jornada completa)
    const slotsRaw = await getAvailableSlots({
      supabase: sb,
      tenantId,
      serviceId: bk.service_id,
      date: dayUTC,
      maxSlots: 1000,
    });

    // Traer reservas ocupadas del día (mismo recurso), excluyendo mi booking
    const busy = await getBusyForDay({
      tenantId,
      resourceId: bk.resource_id,
      dayStartUTC: dayUTC,
      excludeBookingId: bk.id,
    });

    // Excluir misma hora y solapes
    const currentStart = new Date(bk.starts_at);
    const currentEnd = new Date(bk.ends_at);
    const DEBUG = process.env.BOT_DEBUG === "true";

    const slots = (slotsRaw || [])
      .filter((s) => {
        const sStart = s.start instanceof Date ? s.start : new Date(s.start);
        const sEnd = s.end instanceof Date ? s.end : new Date(s.end);

        if (sameStartWithin(+sStart, +currentStart)) {
          if (DEBUG) console.log("[FILTER] drop sameStart", sStart.toISOString());
          return false;
        }
        if (overlaps(sStart, sEnd, currentStart, currentEnd)) {
          if (DEBUG) console.log("[FILTER] drop overlap current", sStart.toISOString(), sEnd.toISOString());
          return false;
        }
        const clash = busy.some((b) => overlaps(sStart, sEnd, new Date(b.starts_at), new Date(b.ends_at)));
        if (clash) {
          if (DEBUG) console.log("[FILTER] drop overlap busy", sStart.toISOString(), sEnd.toISOString());
          return false;
        }
        return true;
      })
      .sort((a, b) => +new Date(a.start as any) - +new Date(b.start as any));

    if (DEBUG) {
      console.log("[SLOTS RAW]", slotsRaw.map((s: any) => new Date(s.start).toISOString()));
      console.log("[BUSY]", busy.map((b: any) => [b.starts_at, b.ends_at]));
      console.log("[SLOTS KEPT]", slots.map((s: any) => new Date(s.start).toISOString()));
    }

    if (!slots.length) {
      await sendWhatsApp(
        phone,
        "Ese día no me quedan horarios libres distintos. Dime otra fecha y te muestro opciones para mover tu cita."
      );
      return true;
    }

    const options = slots
      .map(
        (s, i) => `${i + 1}) ${hourFmtRD.format(new Date(s.start))} con ${s.resource_name}`
      )
      .join("\n");

    await sendWhatsApp(
      phone,
      `Perfecto, puedo moverla. Tengo disponibles:\n${options}\n\nElige un horario enviando un número.`
    );

    return true;
  }

  return false; // no se manejó aquí
}

export async function handleRescheduleChoice(
  tenantId: string,
  phone: string,
  choice: number
) {
  // Recuperar la última cita marcada como 'rescheduled' PARA ESE TELÉFONO (normalizado)
  const norm = normalizePhone(phone);

  // Intento por phone_norm primero
  let bk: any = null;
  try {
    const { data } = await sb
      .from("bookings")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("phone_norm", norm)
      .eq("status", "rescheduled")
      .order("created_at", { ascending: false })
      .limit(1);
    bk = data?.[0] ?? null;
  } catch {
    // ignore
  }

  // Fallback por variantes del número si no hay phone_norm
  if (!bk) {
    const noProto = phone.replace(/^whatsapp:/i, "").trim();
    const noSpaces = noProto.replace(/\s+/g, "");
    const noPlus = noSpaces.replace(/^\+/, "");
    const withPlus = noSpaces.startsWith("+") ? noSpaces : `+${noSpaces}`;
    const candidates = Array.from(new Set([phone, noProto, noSpaces, noPlus, withPlus])).filter(Boolean);

    const { data } = await sb
      .from("bookings")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("customer_phone", candidates)
      .eq("status", "rescheduled")
      .order("created_at", { ascending: false }) // ✅ antes decía updated_at (no existe)
      .limit(1);

    bk = data?.[0] ?? null;
  }

  if (!bk) {
    await sendWhatsApp(phone, "No tengo una cita pendiente por mover.");
    return;
  }

  // Recalcular TODOS los slots del mismo día
  const dayUTC = bookingLocalMidnightAsUTC(bk.starts_at);

  const slotsRaw = await getAvailableSlots({
    supabase: sb,
    tenantId,
    serviceId: bk.service_id,
    date: dayUTC,
    maxSlots: 1000,
  });

  // Busy del día (mismo recurso), excluyendo mi booking
  const busy = await getBusyForDay({
    tenantId,
    resourceId: bk.resource_id,
    dayStartUTC: dayUTC,
    excludeBookingId: bk.id,
  });

  const currentStart = new Date(bk.starts_at);
  const currentEnd = new Date(bk.ends_at);
  const DEBUG = process.env.BOT_DEBUG === "true";

  const slots = (slotsRaw || [])
    .filter((s) => {
      const sStart = s.start instanceof Date ? s.start : new Date(s.start);
      const sEnd = s.end instanceof Date ? s.end : new Date(s.end);

      if (sameStartWithin(+sStart, +currentStart)) {
        if (DEBUG) console.log("[FILTER] drop sameStart", sStart.toISOString());
        return false;
      }
      if (overlaps(sStart, sEnd, currentStart, currentEnd)) {
        if (DEBUG) console.log("[FILTER] drop overlap current", sStart.toISOString(), sEnd.toISOString());
        return false;
      }
      const clash = busy.some((b) => overlaps(sStart, sEnd, new Date(b.starts_at), new Date(b.ends_at)));
      if (clash) {
        if (DEBUG) console.log("[FILTER] drop overlap busy", sStart.toISOString(), sEnd.toISOString());
        return false;
      }
      return true;
    })
    .sort((a, b) => +new Date(a.start as any) - +new Date(b.start as any));

  if (DEBUG) {
    console.log("[SLOTS RAW]", slotsRaw.map((s: any) => new Date(s.start).toISOString()));
    console.log("[BUSY]", busy.map((b: any) => [b.starts_at, b.ends_at]));
    console.log("[SLOTS KEPT]", slots.map((s: any) => new Date(s.start).toISOString()));
  }

  const slot = slots[choice - 1];
  if (!slot) {
    await sendWhatsApp(phone, "Número inválido. Intenta de nuevo.");
    return;
  }

  await sb
    .from("bookings")
    .update({
      starts_at: new Date(slot.start).toISOString(),
      ends_at: new Date(slot.end).toISOString(),
      status: "confirmed",
    })
    .eq("id", bk.id);

  await sendWhatsApp(
    phone,
    `¡Listo! Te reagendé para ${hourFmtRD.format(new Date(slot.start))} con ${slot.resource_name} ✅`
  );
}
