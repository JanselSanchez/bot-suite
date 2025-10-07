// src/app/api/twilio/route.ts
import { supabase } from "@/app/lib/superbase";
import { NextRequest, NextResponse } from "next/server";


// --- útil para probar en el navegador ---
export async function GET() {
  return NextResponse.json({ ok: true, service: "twilio-webhook" });
}

// Twilio envía application/x-www-form-urlencoded
function parseForm(body: string) {
  return Object.fromEntries(new URLSearchParams(body));
}

async function ensureConversation(phone: string) {
  const { data } = await supabase
    .from("conversations")
    .select("id")
    .eq("phone", phone)
    .limit(1)
    .maybeSingle();
  if (data?.id) return data.id;
  const { data: created } = await supabase
    .from("conversations")
    .insert({ phone })
    .select("id")
    .single();
  return created!.id;
}

async function sendWhatsApp(to: string, text: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_WHATSAPP_FROM!; // ej: whatsapp:+14155238886
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");

  const body = new URLSearchParams({ From: from, To: to, Body: text }).toString();
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();          // leer como texto (form-urlencoded)
  const f = parseForm(raw);
  const from = f.From;                   // "whatsapp:+1829XXXXXXX"
  const body = (f.Body || "").trim();

  // Guarda en BD
  const convId = await ensureConversation(from);
  await supabase.from("messages").insert({
    conversation_id: convId,
    role: "user",
    text: body,
  });

  // Respuesta simple (luego metemos FAQs/sector)
  const reply =
    !body
      ? "¿Podrías repetir el mensaje?"
      : body.toLowerCase().includes("hola")
      ? "¡Hola! 👋 Soy tu asistente. ¿En qué puedo ayudarte?"
      : "Recibido ✅. En breve te ayudamos.";

  await sendWhatsApp(from, reply);

  await supabase.from("messages").insert({
    conversation_id: convId,
    role: "bot",
    text: reply,
  });

  // Twilio solo necesita 200 (TwiML opcional)
  return new Response("<Response/>", { headers: { "Content-Type": "text/xml" } });
}
