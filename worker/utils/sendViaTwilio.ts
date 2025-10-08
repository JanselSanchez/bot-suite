import twilio from "twilio";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM!;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM) {
  console.error("⚠️ Falta configuración Twilio en .env.local");
}

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

/**
 * Envía un mensaje de WhatsApp vía Twilio.
 * Se usa desde el worker al generar la respuesta del bot.
 */
export async function sendViaTwilio(to: string, body: string) {
  try {
    if (!to.startsWith("whatsapp:")) {
      to = `whatsapp:${to}`;
    }

    const msg = await client.messages.create({
      from: TWILIO_WHATSAPP_FROM,
      to,
      body,
    });

    console.log(`📤 Twilio enviado a ${to} | SID: ${msg.sid}`);
    return msg.sid;
  } catch (err: any) {
    console.error("❌ Error enviando Twilio:", err.message || err);
  }
}
