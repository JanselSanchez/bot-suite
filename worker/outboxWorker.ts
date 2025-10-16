import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

const MAX_ATTEMPTS = 8;

function nextBackoffMs(attempts: number) {
  // exponencial con jitter (30s, 1m, 2m, 4m, 8m...)
  const base = Math.min(30 * 1000 * Math.pow(2, Math.max(0, attempts - 1)), 30 * 60 * 1000);
  const jitter = Math.floor(Math.random() * 5000);
  return base + jitter;
}

async function fetchDue(limit = 20) {
  const { data, error } = await supabase
    .from("outbox")
    .select("id, tenant_id, channel, to, body, event, attempts")
    .in("status", ["pending", "retry"])
    .lte("retry_at", new Date().toISOString())
    .order("retry_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

async function sendOne(msg: any) {
  // por ahora solo WhatsApp/SMS vía Twilio
  const { sendViaTwilio } = await import("./utils/sendViaTwilio");
  await sendViaTwilio(msg.to, msg.body);
}

async function markResult(id: string, ok: boolean, attempts: number, errMsg?: string) {
  if (ok) {
    await supabase.from("outbox").update({
      status: "sent",
      updated_at: new Date().toISOString(),
      last_error: null
    }).eq("id", id);
  } else {
    const tooMany = attempts + 1 >= MAX_ATTEMPTS;
    await supabase.from("outbox").update({
      status: tooMany ? "failed" : "retry",
      attempts: attempts + 1,
      updated_at: new Date().toISOString(),
      last_error: errMsg ?? "unknown",
      retry_at: tooMany ? new Date().toISOString() : new Date(Date.now() + nextBackoffMs(attempts + 1)).toISOString()
    }).eq("id", id);
  }
}

export function startOutboxWorker() {
  const TICK_MS = 15_000; // corre cada 15s
  const timer = setInterval(async () => {
    try {
      const due = await fetchDue(25);
      for (const msg of due) {
        try {
          await sendOne(msg);
          await markResult(msg.id, true, msg.attempts);
        } catch (e: any) {
          const message = String(e?.message || e);
          // si vuelve a ser 429 o similar, se reintenta con backoff
          await markResult(msg.id, false, msg.attempts, message);
        }
      }
    } catch (e) {
      console.error("[outbox] tick error:", e);
    }
  }, TICK_MS);

  console.log("📫 Outbox worker iniciado (tick 15s).");
  return () => clearInterval(timer);
}
