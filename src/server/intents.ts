// src/server/intents.ts
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

export type Intent =
  | "book"
  | "cancel"
  | "reschedule"
  | "confirm"
  | "pricing" // preguntar por planes / precios
  | "unknown";

// Cliente Supabase (server-side, con service role)
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Cliente OpenAI para la capa de IA
const ai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function detectIntentBasic(
  text: string,
  tenantId?: string
): Promise<Intent> {
  const clean = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();

  // 1) Intent básico por palabras clave
  try {
    const { data, error } = await sb
      .from("intent_keywords")
      .select("intent, term")
      .or(`tenant_id.eq.${tenantId ?? "null"},tenant_id.is.null`);

    if (error) {
      console.error("[detectIntentBasic] error cargando keywords:", error);
    } else {
      for (const row of data ?? []) {
        const term = row.term
          .toLowerCase()
          .normalize("NFD")
          .replace(/\p{Diacritic}/gu, "");

        if (clean.includes(term)) {
          return row.intent as Intent;
        }
      }
    }
  } catch (e) {
    console.error("[detectIntentBasic] error leyendo intent_keywords:", e);
    // seguimos al fallback de IA
  }

  // 2) Fallback de IA: clasificar el mensaje
  try {
    const completion = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 5,
      messages: [
        {
          role: "system",
          content: `
Eres un clasificador de intención para un asistente de WhatsApp de negocios.
Solo puedes responder UNA palabra exactamente igual a una de estas:

- "book"        -> cuando el usuario saluda, pide ayuda, quiere información general, pregunta horarios o quiere agendar algo.
- "cancel"      -> cuando el usuario quiere cancelar una cita.
- "reschedule"  -> cuando quiere cambiar la fecha/hora de una cita.
- "confirm"     -> cuando quiere confirmar asistencia.
- "pricing"     -> cuando pregunta por precios, planes, tarifas, cuánto cuesta.
- "unknown"     -> solo si de verdad no puedes clasificar.

No expliques nada, no escribas frases, responde SOLO una palabra de la lista.
          `,
        },
        { role: "user", content: text },
      ],
    });

    const raw = (completion.choices[0].message.content || "")
      .trim()
      .toLowerCase() as Intent;

    const allowed: Intent[] = [
      "book",
      "cancel",
      "reschedule",
      "confirm",
      "pricing",
      "unknown",
    ];

    if (allowed.includes(raw)) {
      // Si la IA dice "unknown", como fallback usamos "book"
      return raw === "unknown" ? "book" : raw;
    }

    // Si por alguna razón devuelve algo raro, usamos "book" para no quedarnos callados
    return "book";
  } catch (e) {
    console.error("[detectIntentBasic][ai] error:", e);
    // Fallback final: que el bot arranque siempre flujo principal
    return "book";
  }
}
