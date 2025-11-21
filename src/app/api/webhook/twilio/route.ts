// src/app/api/webhook/twilio/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { enqueueWhatsapp } from "@/server/queue";

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
  // Mientras pruebas: deja TWILIO_VERIFY_SIGNATURE sin definir o "false"
  if (process.env.TWILIO_VERIFY_SIGNATURE !== "true") return true;

  const token = process.env.TWILIO_AUTH_TOKEN!;
  const sig = req.headers.get("x-twilio-signature") || "";
  const url = process.env.PUBLIC_WEBHOOK_URL || req.url;

  const params = new URLSearchParams(rawBody);
  const keys = Array.from(params.keys()).sort();
  const concatenated = keys.map((k) => params.getAll(k).join("")).join("");
  const data = url + concatenated;

  const expected = crypto
    .createHmac("sha1", token)
    .update(Buffer.from(data, "utf-8"))
    .digest("base64");

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* DB helpers */
async function ensureConversation(phone: string, tenantId?: string | null) {
  const { data: sel, error: selErr } = await supabaseAdmin
    .from("conversations")
    .select("id, tenant_id")
    .eq("phone", phone)
    .limit(1)
    .maybeSingle();

  if (selErr) {
    console.error("[ensureConversation.select] error:", selErr);
  }

  // Ya existe conversación
  if (sel?.id) {
    if (!sel.tenant_id && tenantId) {
      const { error: updErr } = await supabaseAdmin
        .from("conversations")
        .update({ tenant_id: tenantId })
        .eq("id", sel.id);

      if (updErr) {
        console.error("[ensureConversation.update] error:", updErr);
      }
    }
    return sel.id as string;
  }

  // Crear nueva conversación
  const { data: ins, error } = await supabaseAdmin
    .from("conversations")
    .insert({ phone, tenant_id: tenantId ?? null })
    .select("id")
    .single();

  if (error) {
    console.error("[ensureConversation.insert] error:", error);
    return null;
  }

  return (ins?.id as string) ?? null;
}

async function logMessage(
  conversation_id: string | null,
  role: "user" | "assistant",
  text: string
) {
  const payload: Record<string, unknown> = { role, content: text }; // columna correcta: content
  if (conversation_id) payload.conversation_id = conversation_id;

  const { error } = await supabaseAdmin.from("messages").insert(payload);
  if (error) console.error("[logMessage] error:", error);
}

async function findTenantByBotNumber(waTo: string) {
  const e164 = toE164(waTo);

  const { data, error } = await supabaseAdmin
    .from("tenants")
    .select("id, name, valid_until, grace_days, wa_number, phone")
    .eq("wa_number", e164)
    .maybeSingle();

  if (error) console.error("[tenants wa_number] error:", error);

  // usamos una variable mutable separada para no romper prefer-const
  let tenantData = data ?? null;

  if (!tenantData) {
    const whatsappFmt = `whatsapp:${e164}`;
    const res = await supabaseAdmin
      .from("tenants")
      .select("id, name, valid_until, grace_days, wa_number, phone")
      .eq("phone", whatsappFmt)
      .maybeSingle();

    if (!res.error) tenantData = res.data ?? null;
    else console.error("[tenants phone] error:", res.error);
  }

  return tenantData ?? null;
}

function isBlockedByBilling(tenant: {
  valid_until: string | null;
  grace_days: number | null;
  due_on?: string | null;
}) {
  const ref = tenant.valid_until ?? tenant.due_on ?? null;
  if (!ref) return false;

  const dueMs = new Date(ref).getTime();
  const graceMs = (tenant.grace_days ?? 0) * 24 * 60 * 60 * 1000;
  return Date.now() > dueMs + graceMs;
}

async function sendWhatsApp(to: string, text: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_WHATSAPP_FROM!; // "whatsapp:+14155238886"
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");

  await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: from,
        To: to,
        Body: text,
      }).toString(),
    }
  );
}

/* Routes */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "twilio-webhook",
  });
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();

    if (!verifyTwilioSignature(req, raw)) {
      console.warn("⚠️ Twilio signature verification failed");
      return new NextResponse("<Response/>", {
        headers: { "Content-Type": "text/xml" },
        status: 200,
      });
    }

    const form = parseForm(raw);

    const from = String(form.From || ""); // "whatsapp:+1829..."
    const to = String(form.To || ""); // "whatsapp:+1415..."
    const body = String(form.Body || "").trim();

    if (!from || !to || !body) {
      console.warn("[twilio-webhook] payload incompleto:", { from, to, body });
      return new NextResponse("<Response/>", {
        headers: { "Content-Type": "text/xml" },
        status: 200,
      });
    }

    const fromE164 = toE164(from);
    const botE164 = toE164(to);

    // Buscar tenant por número del bot
    const tenant = await findTenantByBotNumber(to);
    const tenantId = tenant?.id as string | undefined;

    // Crear / actualizar conversación con tenant_id
    const convId = await ensureConversation(fromE164, tenantId ?? null);
    if (!convId) {
      console.error("[twilio-webhook] no pude crear conversación");
      return new NextResponse("<Response/>", {
        headers: { "Content-Type": "text/xml" },
        status: 200,
      });
    }

    // Loguear mensaje del usuario
    await logMessage(convId, "user", body);

    // Si no hay tenant, para pruebas respondemos algo genérico
    if (!tenant) {
      console.warn("⚠️ Bot number not linked to any tenant:", botE164);

      const fallbackText =
        'Este número todavía no está vinculado a un negocio en el panel. (modo sandbox)';
      await sendWhatsApp(from, fallbackText);
      await logMessage(convId, "assistant", fallbackText);

      return new NextResponse("<Response/>", {
        headers: { "Content-Type": "text/xml" },
        status: 200,
      });
    }

    // Bloqueo por billing
    if (isBlockedByBilling(tenant)) {
      const msg =
        "⚠️ Servicio temporalmente suspendido por pago pendiente. " +
        "Por favor, contacta al negocio para reactivar.";
      await sendWhatsApp(from, msg);
      await logMessage(convId, "assistant", msg);
      return new NextResponse("<Response/>", {
        headers: { "Content-Type": "text/xml" },
        status: 200,
      });
    }

    // --- LÓGICA DE RESPUESTA ---
    // Si no hay REDIS_URL (como ahora en Render), respondemos directo por Twilio.
    if (!process.env.REDIS_URL) {
      // Aquí por ahora hacemos un eco simple.
      // Luego puedes reemplazar esto por tu lógica de IA / plantillas.
      const replyText = `Recibido: "${body}"`;

      await sendWhatsApp(from, replyText);
      await logMessage(convId, "assistant", replyText);
    } else {
      // Encolar para el worker: job "user-message" con conversationId + texto
      await enqueueWhatsapp("user-message", {
        conversationId: convId,
        text: body,
      });
    }

    // Twilio solo necesita 200 OK
    return new NextResponse("<Response/>", {
      headers: { "Content-Type": "text/xml" },
      status: 200,
    });
  } catch (err) {
    console.error("Webhook error:", err);
    return new NextResponse("<Response/>", {
      headers: { "Content-Type": "text/xml" },
      status: 200,
    });
  }
}
