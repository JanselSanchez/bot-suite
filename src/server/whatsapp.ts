// src/server/whatsapp.ts
import { whatsappQueue, type WhatsappJobPayload } from "@/server/queue";

// Si quieres seguir usando el union para tener semántica clara:
export type WhatsappEventType =
  | "booking_created"
  | "booking_rescheduled"
  | "booking_cancelled"
  | "generic";

/**
 * Encola un mensaje de WhatsApp para que lo procese el worker.
 * Se usa en APIs de reservas, recordatorios, cancelaciones, etc.
 */
export async function enqueueWhatsappMessage(
  payload: WhatsappJobPayload & {
    tenantId: string;
    to: string;
    event: WhatsappEventType;
    body?: string;
    templateKey?: string;
    variables?: Record<string, string>;
  }
): Promise<void> {
  if (!whatsappQueue) {
    console.warn(
      "[whatsapp] Cola deshabilitada, mensaje NO encolado:",
      payload
    );
    return;
  }

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
export { WhatsappJobPayload };

