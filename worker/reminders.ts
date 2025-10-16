// worker/reminders.ts
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { createClient } from "@supabase/supabase-js";

const REDIS_URL = process.env.REDIS_URL!;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const connection = new IORedis(REDIS_URL, {
  tls: REDIS_URL.startsWith("rediss://") ? {} : undefined,
  family: 4,
  connectTimeout: 20000,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});
const queue = new Queue("reminders", { connection });
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

// Utilidad simple
function toLocalTimeLabel(dISO: string, tz: string) {
  return new Date(dISO).toLocaleTimeString("es-DO", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz || "America/Santo_Domingo",
  });
}

async function sendWhatsApp(to: string, body: string) {
  if (!to) return;
  try {
    const { sendViaTwilio } = await import("./utils/sendViaTwilio");
    await sendViaTwilio(to, body);
  } catch (e) {
    console.error("[reminders sendWhatsApp] error:", e);
  }
}

/**
 * Programa el job diario por tenant usando su horario
 * - Si quieres algo global, puedes poner un único pattern fijo
 */
export async function scheduleDailyReminders() {
  // Tomamos todos los tenants y sus settings
  const { data: tenants } = await sb
    .from("tenant_settings")
    .select("tenant_id, timezone, default_reminder_hour");

  for (const t of tenants ?? []) {
    const tz = t.timezone || "America/Santo_Domingo";
    const hour = t.default_reminder_hour ?? 9;

    await queue.add(
      `reminders-run-${t.tenant_id}`,
      { tenantId: t.tenant_id },
      { repeat: { tz, pattern: `0 ${hour} * * *` } } // todos los días a HH:00
    );
  }
  console.log("⏰ Recordatorios programados por tenant.");
}

// Worker que procesa los recordatorios (por tenant)
export function startRemindersWorker() {
  new Worker(
    "reminders",
    async (job) => {
      const { tenantId } = job.data as { tenantId: string };
      if (!tenantId) return;

      // settings del tenant
      const { data: settings } = await sb
        .from("tenant_settings")
        .select("timezone, brand_name")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      const tz = settings?.timezone || "America/Santo_Domingo";
      const brand = settings?.brand_name || "nuestro equipo";

      // rango: mañana (00:00 - 23:59)
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);

      const dayStart = new Date(Date.UTC(
        tomorrow.getUTCFullYear(),
        tomorrow.getUTCMonth(),
        tomorrow.getUTCDate(), 0, 0, 0, 0
      ));
      const dayEnd = new Date(Date.UTC(
        tomorrow.getUTCFullYear(),
        tomorrow.getUTCMonth(),
        tomorrow.getUTCDate(), 23, 59, 59, 999
      ));

      // citas confirmadas de mañana
      const { data: bookings, error } = await sb
        .from("bookings")
        .select("id, customer_name, customer_phone, starts_at, staff_name")
        .eq("tenant_id", tenantId)
        .eq("status", "confirmed")
        .gte("starts_at", dayStart.toISOString())
        .lte("starts_at", dayEnd.toISOString());

      if (error) {
        console.error("[reminders select bookings] error:", error);
        return;
      }

      for (const b of bookings ?? []) {
        const time = toLocalTimeLabel(b.starts_at, tz);
        const msg = `¡Hola ${b.customer_name ?? ""}! Te recordamos tu cita **mañana** a las ${time} con ${b.staff_name ?? brand}. 
Responde *CONFIRMAR* si vas a asistir o *CANCELAR* si no puedes.`;

        await sendWhatsApp(b.customer_phone, msg);

        // marcar temporalmente como unconfirmed hasta respuesta
        await sb.from("bookings").update({ status: "unconfirmed" }).eq("id", b.id);

        // opcional: contador de uso
        try {
          const d = new Date();
          await sb.rpc("bump_reminders_sent", {
            p_tenant: tenantId,
            p_y: d.getFullYear(),
            p_m: d.getMonth() + 1,
          });
        } catch (e) {
          // si no existe la RPC, ignorar
        }
      }

      console.log(`📨 Enviados recordatorios tenant=${tenantId} count=${bookings?.length ?? 0}`);
    },
    { connection }
  );
}
