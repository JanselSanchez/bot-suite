// src/server/whatsapp.ts

export type WhatsappEventType =
  | "booking_created"
  | "booking_rescheduled"
  | "booking_cancelled"
  | "generic";

// Payload para mensajes de texto / plantillas
export interface WhatsappJobPayload {
  tenantId: string;
  to: string;
  event: WhatsappEventType | string;
  body?: string; // Texto directo (si el evento es 'generic')
  templateKey?: string;
  variables?: Record<string, string>;
  meta?: any;
}

// Payload para archivos multimedia (.ics, imágenes, PDFs)
export interface WhatsappMediaPayload {
  tenantId: string;
  to: string;
  type: 'document' | 'image' | 'audio' | 'video';
  base64: string;      // El archivo convertido a string base64
  fileName?: string;   // Ej: "cita.ics"
  mimetype?: string;   // Ej: "text/calendar"
  caption?: string;    // Texto que acompaña al archivo
}

const WA_SERVER_URL = process.env.WA_SERVER_URL || "http://localhost:4001";

/**
 * Envia mensajes de texto o plantillas (Eventos)
 */
export async function enqueueWhatsappMessage(
  payload: WhatsappJobPayload
): Promise<void> {
  const { tenantId, to, event, variables, body } = payload;

  try {
    const res = await fetch(`${WA_SERVER_URL}/sessions/${tenantId}/send-template`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: to,
        event: event,
        body: body, // Enviamos el cuerpo si existe (útil para respuestas de IA)
        variables: variables || {},
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[Whatsapp] Error enviando texto: ${res.status} - ${errText}`);
    }
  } catch (e) {
    console.error(`[Whatsapp] Fallo de conexión con el bot (Texto):`, e);
  }
}

/**
 * Envia archivos adjuntos (Documentos, Imágenes, Audios)
 * Usado para enviar el archivo .ics de la agenda
 */
export async function sendWhatsappMedia(
  payload: WhatsappMediaPayload
): Promise<void> {
  const { tenantId, to, type, base64, fileName, mimetype, caption } = payload;

  try {
    // Asumimos que tu servidor de bots tiene este endpoint.
    // Si no lo tiene, deberás crearlo en tu microservicio (puerto 4001).
    const res = await fetch(`${WA_SERVER_URL}/sessions/${tenantId}/send-media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: to,
        type,
        base64,
        fileName,
        mimetype,
        caption
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[Whatsapp] Error enviando media: ${res.status} - ${errText}`);
    } else {
      console.log(`[Whatsapp] 📎 Archivo enviado a ${to}`);
    }
  } catch (e) {
    console.error(`[Whatsapp] Fallo de conexión con el bot (Media):`, e);
  }
}