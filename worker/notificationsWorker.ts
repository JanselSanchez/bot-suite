import "dotenv/config";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { Worker } from "bullmq";
import IORedis from "ioredis";
import { createClient } from "@supabase/supabase-js";

// ---------- ENV ----------
const REDIS_URL = process.env.REDIS_URL!;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

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

// ---- utils de formato RD
const hourFmtRD = new Intl.DateTimeFormat("es-DO", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
  timeZone: "America/Santo_Domingo",
});
function formatDateEsDO(d: Date) {
  return new Intl.DateTimeFormat("es-DO", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Santo_Domingo",
  }).format(d);
}

// ---- plantillas por defecto (fallback)
const DEFAULT_TEMPLATES: Record<string, string> = {
  booking_confirmed:
    "¡Hola {{customer_name}}! ✅ Tu cita quedó para el {{date}} a las {{time}} con {{resource_name}}.",
  booking_rescheduled:
    "🔁 Reprogramamos tu cita para el {{date}} a las {{time}} con {{resource_name}}.",
  booking_cancelled:
    "❌ Tu cita del {{date}} a las {{time}} con {{resource_name}} fue cancelada.",
  reminder:
    "⏰ Recordatorio: {{date}} {{time}} con {{resource_name}}. Responde *CANCELAR* o *REPROGRAMAR* si necesitas cambiar.",
  payment_required:
    "🔒 Tu suscripción está inactiva. Actívala aquí: {{payment_link}}",
};

function renderTemplate(body: string, vars: Record<string, string>) {
  return body.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

async function getTemplateOrDefault(tenantId: string, channel: string, event: string) {
  const { data } = await supabase
    .from("message_templates")
    .select("body, active")
    .eq("tenant_id", tenantId)
    .eq("channel", channel)
    .eq("event", event)
    .maybeSingle();
  if (data?.active && data?.body) return data.body as string;
  return DEFAULT_TEMPLATES[event] || DEFAULT_TEMPLATES["reminder"];
}

type JobPayload = {
  tenantId: string;
  channel: "whatsapp" | "sms" | "email";
  event: "booking_confirmed" | "booking_rescheduled" | "booking_cancelled" | "reminder" | "payment_required";
  phone?: string;           // para whatsapp/sms
  email?: string;           // si usas email
  vars: {
    customer_name?: string;
    date?: string;          // si no viene, lo armamos con startsAt
    time?: string;
    resource_name?: string;
    payment_link?: string;
    startsAt?: string;      // ISO
    resourceId?: string;
  };
};

async function sendWhatsApp(to: string, body: string) {
  try {
    const { sendViaTwilio } = await import("./utils/sendViaTwilio");
    await sendViaTwilio(to, body);
  } catch (e: any) {
    // 429 → outbox para retry
    await supabase.from("outbox").insert({
      tenant_id: null, // si quieres, setéalo con el tenant real
      channel: "whatsapp",
      "to": to,
      body,
      event: "notification",
      status: "retry",
      last_error: String(e?.message || e),
      attempts: 1,
      retry_at: new Date(Date.now() + 30_000).toISOString(),
    } as any);
    throw e;
  }
}

export const notificationsWorker = new Worker(
  "notifications-queue",
  async (job) => {
    const payload = job.data as JobPayload;

    const template = await getTemplateOrDefault(payload.tenantId, payload.channel, payload.event);

    // Normaliza fecha/hora si vienen startsAt
    let date = payload.vars.date;
    let time = payload.vars.time;
    if (payload.vars.startsAt) {
      const d = new Date(payload.vars.startsAt);
      date = date || formatDateEsDO(d);
      time = time || hourFmtRD.format(d);
    }

    const body = renderTemplate(template, {
      customer_name: payload.vars.customer_name || "Cliente",
      date: date || "",
      time: time || "",
      resource_name: payload.vars.resource_name || "nuestro equipo",
      payment_link: payload.vars.payment_link || "",
    });

    if (payload.channel === "whatsapp" || payload.channel === "sms") {
      if (!payload.phone) return;
      await sendWhatsApp(payload.phone, body);
    }
    // email: implementar cuando habilites proveedor
  },
  { connection }
);

notificationsWorker.on("completed", (job) => console.log(`📣 notification job ${job.id} done`));
notificationsWorker.on("failed", (job, err) => console.error(`📣 notification job ${job?.id} failed:`, err?.message));
console.log("📣 Notifications worker corriendo…");
