// worker/utils/sendViaTwilio.ts
import twilio from "twilio";

const SID = process.env.TWILIO_ACCOUNT_SID!;
const TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const FROM_WA = process.env.TWILIO_WHATSAPP_FROM; // e.g. whatsapp:+14155238886
const FROM_SMS = process.env.TWILIO_SMS_FROM;     // si quieres SMS (opcional)

if (!SID || !TOKEN) {
  throw new Error("Faltan TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN");
}

const client = twilio(SID, TOKEN);

/**
 * Envia por WhatsApp si el 'to' empieza con 'whatsapp:'.
 * Si no, intenta SMS (requiere FROM_SMS y que el to esté verificado si tu cuenta es trial).
 */
export async function sendViaTwilio(to: string, body: string) {
  const isWhatsApp = to.startsWith("whatsapp:");
  const from = isWhatsApp ? FROM_WA : FROM_SMS;

  if (!from) {
    console.warn(`[twilio] No hay remitente configurado para ${isWhatsApp ? "WhatsApp" : "SMS"}.`);
    return;
  }

  try {
    const msg = await client.messages.create({ from, to, body });
    console.log(`[twilio] sent OK sid=${msg.sid} to=${to}`);
  } catch (err: any) {
    // Errores típicos:
    // - 63016 Not a valid 'To' number for WhatsApp
    // - 63018 Unapproved template/out-of-session (para cuentas WA Business; en sandbox no aplica si te uniste)
    // - 21606 The 'To' phone number provided is not a valid SMS-capable number
    console.error("[twilio] send error:", err?.code, err?.message);
    throw err;
  }
}
