import { supabaseAdmin } from "@/app/lib/superbase";
import { NextRequest } from "next/server";
import crypto from "crypto";

/* Utils */
function toE164(s: string): string {
  const v = s.replace(/^whatsapp:/i, "").trim();
  if (v.startsWith("+")) return v;
  if (/^\d+$/.test(v)) return `+${v}`;
  return v;
}
function parseForm(body: string) {
  return Object.fromEntries(new URLSearchParams(body));
}
function verifyTwilioSignature(req: NextRequest, rawBody: string) {
  if (process.env.TWILIO_VERIFY_SIGNATURE !== "true") return true;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const sig = req.headers.get("x-twilio-signature") || "";
  const url = process.env.PUBLIC_WEBHOOK_URL || req.url;
  const params = new URLSearchParams(rawBody);
  const keys = Array.from(params.keys()).sort();
  const concatenated = keys.map((k) => params.getAll(k).join("")).join("");
  const data = url + concatenated;
  const expected = crypto.createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* DB helpers */
async function ensureConversation(phone: string) {
  const { data: sel } = await supabaseAdmin
    .from("conversations")
    .select("id")
    .eq("phone", phone)
    .limit(1)
    .maybeSingle();
  if (sel?.id) return sel.id;
  const { data: ins } = await supabaseAdmin
    .from("conversations")
    .insert({ phone })
    .select("id")
    .single();
  return ins?.id ?? null;
}
async function logMessage(conversation_id: number | null, role: "user" | "bot", text: string) {
  const payload: any = { role, text };
  if (conversation_id) payload.conversation_id = conversation_id;
  await supabaseAdmin.from("messages").insert(payload);
}

async function findTenantByBotNumber(waTo: string) {
  const e164 = toE164(waTo);
  // 1) si tienes columna wa_number (E.164 sin 'whatsapp:')
  let { data, error } = await supabaseAdmin
    .from("tenants")
    .select("id,name,valid_until,grace_days,wa_number,phone")
    .eq("wa_number", e164)
    .maybeSingle();
  if (error) console.error("tenants wa_number error:", error);

  // 2) fallback: intenta con phone almacenado como 'whatsapp:+...'
  if (!data) {
    const whatsappFmt = `whatsapp:${e164}`;
    const res = await supabaseAdmin
      .from("tenants")
      .select("id,name,valid_until,grace_days,wa_number,phone")
      .eq("phone", whatsappFmt)
      .maybeSingle();
    if (!res.error) data = res.data ?? null;
  }
  return data ?? null;
}

function isBlockedByBilling(tenant: { valid_until: string | null; grace_days: number | null; due_on?: string | null }) {
  // Preferimos valid_until. Si no existe, usamos due_on como legado.
  const ref = tenant.valid_until ?? tenant.due_on ?? null;
  if (!ref) return false;
  const dueMs = new Date(ref).getTime();
  const graceMs = (tenant.grace_days ?? 0) * 24 * 60 * 60 * 1000;
  return Date.now() > dueMs + graceMs;
}

async function sendWhatsApp(to: string, text: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_WHATSAPP_FROM!;
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

/* Routes */
export async function GET() {
  return new Response(JSON.stringify({ ok: true, service: "twilio-webhook" }), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    if (!verifyTwilioSignature(req, raw)) {
      console.warn("⚠️ Twilio signature verification failed");
      return new Response("<Response/>", { headers: { "Content-Type": "text/xml" }, status: 200 });
    }

    const form = parseForm(raw);
    const from = String(form.From || "");   // "whatsapp:+1..."
    const to   = String(form.To   || "");   // "whatsapp:+1415..."
    const body = String(form.Body || "").trim();

    const fromE164 = toE164(from);
    const botE164  = toE164(to);

    const convId = await ensureConversation(fromE164);
    if (body) await logMessage(convId, "user", body);

    const tenant = await findTenantByBotNumber(to);
    if (!tenant) {
      console.warn("⚠️ Bot number not linked to any tenant:", botE164);
      return new Response("<Response/>", { headers: { "Content-Type": "text/xml" } });
    }

    if (isBlockedByBilling(tenant)) {
      const msg =
        "⚠️ Servicio temporalmente suspendido por pago pendiente. " +
        "Por favor, contacta al negocio para reactivar.";
      await sendWhatsApp(from, msg);
      await logMessage(convId, "bot", msg);
      return new Response("<Response/>", { headers: { "Content-Type": "text/xml" } });
    }

    // Respuesta simple de ejemplo
    const low = body.toLowerCase();
    const reply = low.includes("hola") || low.includes("buenas") || low === "hi"
      ? "👋 ¡Hola! Bot operativo con Twilio ✅"
      : "Recibido ✅. ¿En qué puedo ayudarte?";

    await sendWhatsApp(from, reply);
    await logMessage(convId, "bot", reply);
    return new Response("<Response/>", { headers: { "Content-Type": "text/xml" } });
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response("<Response/>", { headers: { "Content-Type": "text/xml" }, status: 200 });
  }
}
