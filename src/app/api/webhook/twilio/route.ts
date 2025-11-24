// src/app/api/webhook/twilio/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

// ---------- OpenAI client ----------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ---------- Utils ----------

function parseForm(body: string) {
  return new URLSearchParams(body);
}

function normalizeWhatsApp(value: string): string {
  // viene como "whatsapp:+1829..." o "+1829..."
  if (value.startsWith("whatsapp:")) return value;
  if (value.startsWith("+")) return `whatsapp:${value}`;
  return value;
}

async function sendViaTwilioApi(toWhatsApp: string, text: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const fromWhatsApp =
    process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";

  if (!sid || !token) {
    console.error("[wa-webhook] Falta SID o TOKEN en env");
    return;
  }

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");

  const body = new URLSearchParams({
    From: fromWhatsApp,
    To: toWhatsApp,
    Body: text,
  }).toString();

  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    }
  );

  const textResp = await resp.text();
  console.log("[wa-webhook] Twilio API status:", resp.status);
  console.log("[wa-webhook] Twilio API resp:", textResp);
}

async function buildAiReply(userText: string): Promise<string> {
  // Si no hay API key, devolvemos algo fijo pero decente
  if (!process.env.OPENAI_API_KEY) {
    console.warn("[wa-webhook] OPENAI_API_KEY no definido, usando fallback");
    return (
      "Hola 🤍, gracias por escribirme.\n\n" +
      `Ahora mismo no tengo acceso a la IA, pero ya leí tu mensaje: "${userText}". ` +
      "Estoy en modo demo, pronto podré ayudarte con respuestas más inteligentes."
    );
  }

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.6,
      max_tokens: 220,
      messages: [
        {
          role: "system",
          content:
            "Eres un asistente de WhatsApp cálido, amable y profesional. " +
            "Respondes en español neutro, con tono cercano pero respetuoso. " +
            "Siempre suenas humano, claro y directo, sin párrafos eternos. " +
            "Puedes hacer preguntas de seguimiento si hace falta para ayudar mejor.",
        },
        {
          role: "user",
          content: userText,
        },
      ],
    });

    const text =
      completion.choices[0]?.message?.content?.trim() ??
      "Gracias por tu mensaje 🤍. Estoy aquí para ayudarte.";

    return text;
  } catch (err) {
    console.error("[wa-webhook] error OpenAI:", err);
    return (
      "Gracias por escribirme 🤍.\n\n" +
      "Ahora mismo tuve un problema para conectarme con la IA, " +
      "pero ya estoy recibiendo tus mensajes. Intenta de nuevo en unos minutos."
    );
  }
}

// ---------- Routes ----------

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "twilio-webhook-ia",
  });
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    console.log("[wa-webhook] raw body:", raw);

    const params = parseForm(raw);
    const from = params.get("From") || "";
    const body = (params.get("Body") || "").trim();

    console.log("[wa-webhook] parsed:", { from, body });

    if (!from || !body) {
      console.warn("[wa-webhook] payload incompleto");
      return new NextResponse("<Response/>", {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    }

    const toWhatsApp = normalizeWhatsApp(from);

    // 🔥 Pedimos respuesta a la IA
    const replyText = await buildAiReply(body);

    // Enviamos la respuesta al usuario por WhatsApp
    await sendViaTwilioApi(toWhatsApp, replyText);

    // Twilio solo necesita 200 OK, el mensaje ya fue enviado por la API
    return new NextResponse("<Response/>", {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  } catch (err) {
    console.error("[wa-webhook] error general:", err);
    return new NextResponse("<Response/>", {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }
}
