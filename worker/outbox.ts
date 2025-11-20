// worker/outbox.ts
import "dotenv/config";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/app/lib/alerting";
import { sendViaTwilio } from "./utils/sendViaTwilio";

const REDIS_URL = process.env.REDIS_URL;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!REDIS_URL) {
  throw new Error("REDIS_URL no está definida para outbox worker");
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
}

const connection = new IORedis(REDIS_URL);

const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS ?? 6);

type OutboxRow = {
  id: string;
  tenant_id: string | null;
  channel: string;
  to: string | null;
  body: string | null;
  status: "pending" | "queued" | "sent" | "failed";
  attempts: number | null;
  last_error: string | null;
};

async function processOutboxBatch(): Promise<void> {
  const { data, error } = await supabase
    .from("outbox")
    .select(
      "id, tenant_id, channel, to, body, status, attempts, last_error"
    )
    .in("status", ["pending", "queued"])
    .order("created_at", { ascending: true })
    .limit(20);

  if (error) {
    console.error("[outbox] error listando registros:", error);
    await reportError(
      {
        source: "worker:outbox",
        severity: "error",
        code: "OUTBOX_SELECT_ERROR",
        err: error,
        context: {},
      },
      {
        source: ""
      }
    );
    return;
  }

  const rows: OutboxRow[] = (data ?? []) as OutboxRow[];

  for (const row of rows) {
    const to = row.to ?? "";
    const body = row.body ?? "";

    if (!to || !body) {
      // Payload inválido: márcalo como failed para que no se quede pegado
      await supabase
        .from("outbox")
        .update({
          status: "failed",
          last_error: "Missing 'to' or 'body' in outbox row",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      continue;
    }

    if (row.channel !== "whatsapp") {
      // Por ahora solo manejamos WhatsApp. Otros canales se pueden implementar luego.
      await supabase
        .from("outbox")
        .update({
          status: "failed",
          last_error: `Canal no soportado: ${row.channel}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      continue;
    }

    try {
      // Usa tu helper que ya envía vía Twilio
      await sendViaTwilio(to, body);

      await supabase
        .from("outbox")
        .update({
          status: "sent",
          updated_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", row.id);
    } catch (err: unknown) {
      const attempts = (row.attempts ?? 0) + 1;
      const status: OutboxRow["status"] =
        attempts >= MAX_ATTEMPTS ? "failed" : "pending";
      const message =
        err instanceof Error ? err.message : String(err);

      await supabase
        .from("outbox")
        .update({
          attempts,
          status,
          last_error: message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      if (status === "failed") {
        await reportError(
          {
            source: "worker:outbox",
            severity: "critical",
            code: "OUTBOX_FAILED_MAX",
            err,
            context: {
              outbox_id: row.id,
              attempts,
              tenant_id: row.tenant_id,
            },
          },
          {
            source: ""
          }
        );
      }
    }
  }
}

new Worker(
  "outbox",
  async () => {
    await processOutboxBatch();
  },
  { connection }
);

console.log("✅ Outbox worker iniciado (Supabase + Twilio)");
