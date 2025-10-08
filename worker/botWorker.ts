import "dotenv/config";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { Worker, Job } from "bullmq";
import IORedis from "ioredis";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

// ---------- ENV ----------
const REDIS_URL = process.env.REDIS_URL!;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const MOCK_AI = process.env.MOCK_AI === "true"; // 👈 NUEVO

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
connection.on("error", (e) => console.error("[redis error]", e.message));

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ---------- LÓGICA ----------
async function handleUserMessage(job: Job) {
  const { conversationId, text } = job.data as {
    conversationId: string;
    text: string;
  };

  try {
    // 1) Recuperar contexto (últimos mensajes)
    const { data: history, error: histErr } = await supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(20);

    if (histErr) console.error("history error:", histErr);

    // 2) Generar respuesta (mock o OpenAI)
    let reply = "";

    if (MOCK_AI) {
      reply = `🤖 (modo demo) Me dijiste: "${text}"`;
    } else {
      const messages = [
        { role: "system", content: "Eres un asistente útil y directo. Responde en español." },
        ...(history ?? []).map((m: any) => ({
          role: m.role,
          content: m.content,
        })),
        { role: "user", content: text },
      ] as OpenAI.Chat.Completions.ChatCompletionMessageParam[];

      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages,
          temperature: 0.4,
        });

        reply =
          completion.choices?.[0]?.message?.content?.trim() ??
          "No pude generar respuesta ahora mismo.";
      } catch (err: any) {
        const status = err?.status ?? err?.response?.status;
        if (status === 429) throw new Error("OpenAI 429: retry");

        console.error("OpenAI error:", err?.message || err);
        reply = "Estoy un poco ocupado ahora mismo. Intentaré responder en breve.";
      }
    }

    // 3) Guardar respuesta del bot
    const { error: insErr } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: reply,
    });

    if (insErr) console.error("insert assistant error:", insErr);
  } catch (e) {
    console.error("Error general en handleUserMessage:", e);
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
worker.on("failed", (job, err) =>
  console.error(`❌ job ${job?.id} failed:`, err?.message)
);

console.log(
  `✅ Bot worker corriendo${MOCK_AI ? " en modo demo (sin OpenAI)" : ""}…`
);
