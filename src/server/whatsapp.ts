// src/server/whatsapp.ts

export type WhatsappEventType =
  | "booking_created"
  | "booking_rescheduled"
  | "booking_cancelled"
  | "generic";

export interface WhatsappJobPayload {
  tenantId: string;
  to: string;
  event: WhatsappEventType | string;
  body?: string;
  templateKey?: string;
  variables?: Record<string, string>;
  meta?: any;
}

export async function enqueueWhatsappMessage(
  payload: WhatsappJobPayload
): Promise<void> {
  const { tenantId, to, event, variables } = payload;

  const waServerUrl = process.env.WA_SERVER_URL || "http://localhost:4001";

  try {
    const res = await fetch(`${waServerUrl}/sessions/${tenantId}/send-template`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: to,
        event: event,
        variables: variables || {},
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[Whatsapp] Error del bot: ${res.status} - ${errText}`);
    }
  } catch (e) {
    console.error(`[Whatsapp] Fallo de conexión con el bot:`, e);
  }
}