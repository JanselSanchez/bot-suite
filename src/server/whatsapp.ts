// src/app/server/whatsapp.ts
import { whatsappQueue } from "@/server/queue";

// Tipo de evento de negocio
export type WhatsappEventType =
  | "booking_created"
  | "booking_rescheduled"
  | "booking_cancelled"
  | "generic";

// Payload estándar de la cola
export interface WhatsappJobPayload {
  tenantId: string;              // negocio
  to: string;                    // "whatsapp:+1829XXXXXXX"
  event: WhatsappEventType;      // tipo de evento
  body?: string;                 // texto directo (opcional)
  templateKey?: string;          // plantilla interna, ej: "spa_recordatorio"
  variables?: Record<string, string>; // datos para rellenar plantilla
}

/**
 * Encola un mensaje de WhatsApp para que lo procese el worker.
 * Se usa en APIs de reservas, recordatorios, cancelaciones, etc.
 */
export async function enqueueWhatsappMessage(
  payload: WhatsappJobPayload
): Promise<void> {
  if (!whatsappQueue) {
    console.warn("[whatsapp] Cola deshabilitada, mensaje NO encolado:", payload);
    return;
  }

  // Puedes tunear attempts/backoff si quieres
  await whatsappQueue.add("whatsapp_event", payload, {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 3000,
    },
    removeOnComplete: true,
    removeOnFail: 50,
  });
}
