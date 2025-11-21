// src/app/api/webhook/twilio/route.ts
import { NextRequest, NextResponse } from "next/server";

/**
 * Webhook mínimo para Twilio WhatsApp:
 * - No usa Supabase
 * - No usa Redis
 * - No verifica firma
 * - Siempre responde con un eco del mensaje recibido
 */

function escapeXml(unsafe: string) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twimlResponse(text: string) {
  const xml = `<Response><Message>${escapeXml(text)}</Message></Response>`;
  return new NextResponse(xml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "twilio-webhook-minimal",
  });
}

export async function POST(req: NextRequest) {
  try {
    // Twilio envía application/x-www-form-urlencoded
    const raw = await req.text();
    console.log("[twilio-min] raw body:", raw);

    const params = new URLSearchParams(raw);
    const from = params.get("From") || "";
    const to = params.get("To") || "";
    const body = (params.get("Body") || "").trim();

    console.log("[twilio-min] parsed:", { from, to, body });

    if (!from || !to || !body) {
      console.warn("[twilio-min] payload incompleto");
      return new NextResponse("<Response/>", {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    }

    const replyText = `Recibido: "${body}"`;
    return twimlResponse(replyText);
  } catch (err) {
    console.error("[twilio-min] error:", err);
    return new NextResponse("<Response/>", {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }
}
