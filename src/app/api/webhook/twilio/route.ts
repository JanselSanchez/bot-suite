import { supabaseAdmin } from "@/app/lib/superbase";
import { NextRequest } from "next/server";

// --- Healthcheck (abre en el navegador) ---
export async function GET() {
  return new Response(JSON.stringify({ ok: true, service: "twilio-webhook" }), {
    headers: { "Content-Type": "application/json" },
  });
}

// Twilio envía x-www-form-urlencoded
function parseForm(body: string) {
  return Object.fromEntries(new URLSearchParams(body));
}

// crea/obtiene conversación de forma tolerante a fallos
async function ensureConversation(phone: string) {
  const { data: sel, error: selErr } = await supabaseAdmin
    .from("conversations")
    .select("id")
    .eq("phone", phone)
    .limit(1)
    .maybeSingle();

  if (selErr) console.error("select conversations error:", selErr);
  if (sel?.id) return sel.id;

  const { data: ins, error: insErr } = await supabaseAdmin
    .from("conversations")
    .insert({ phone })
    .select("id")
    .single();

  if (insErr) {
    console.error("insert conversations error:", insErr);
    return null;
  }
  return ins?.id ?? null;
}

async function logMessage(conversation_id: number | null, role: "user" | "bot", text: string) {
  const payload: any = { role, text };
  if (conversation_id) payload.conversation_id = conversation_id;

  const { error } = await supabaseAdmin.from("messages").insert(payload);
  if (error) console.error("insert messages error:", error);
}

async function sendWhatsApp(to: string, text: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_WHATSAPP_FROM!; // ej: whatsapp:+14155238886
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");

  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ From: from, To: to, Body: text }).toString(),
  });
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const form = parseForm(raw);

    const from = form.From as string;              // "whatsapp:+1XXXXXXXXXX"
    const message = (form.Body || "").trim();

    console.log("📩 IN:", from, message);

    // guarda en BD (sin romper si falla)
    const convId = await ensureConversation(from);
    await logMessage(convId, "user", message);

    // respuesta simple (luego pluggeamos FAQs/sector)
    const reply = message.toLowerCase().includes("hola")
      ? "👋 ¡Hola! Bot operativo con Twilio + Render ✅"
      : "Recibido ✅. ¿En qué puedo ayudarte?";

    await sendWhatsApp(from, reply);
    await logMessage(convId, "bot", reply);

    // Twilio solo necesita 200
    return new Response("<Response/>", { headers: { "Content-Type": "text/xml" } });
  } catch (err) {
    console.error("Webhook error:", err);
    // devolvemos 200 para evitar reintentos en bucle
    return new Response("<Response/>", { headers: { "Content-Type": "text/xml" }, status: 200 });
  }
}
