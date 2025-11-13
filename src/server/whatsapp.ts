// src/app/server/whatsapp.ts
import Twilio from 'twilio';

const client = Twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

const DEFAULT_FROM = process.env.TWILIO_WHATSAPP_FROM!; // ej: "whatsapp:+14155238886"

export async function sendText(toWhatsApp: string, body: string, fromWhatsApp?: string) {
  const to = toWhatsApp.startsWith('whatsapp:') ? toWhatsApp : `whatsapp:${toWhatsApp}`;
  const from = fromWhatsApp ?? DEFAULT_FROM;
  return client.messages.create({ from, to, body });
}
