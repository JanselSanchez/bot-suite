// src/server/whatsapp.ts

// 1. Definimos los tipos aquí mismo (ya que borramos @/server/queue)
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

/**
 * REEMPLAZO DE COLA: Envía el mensaje DIRECTAMENTE al bot local via HTTP.
 * Mantenemos el nombre de la función para no romper otras importaciones en tu proyecto.
 */
export async function enqueueWhatsappMessage(
  payload: WhatsappJobPayload
): Promise<void> {
  const { tenantId, to, event, variables } = payload;

  // URL del bot local (en Render, ambos corren en el mismo entorno o se comunican por localhost/variable)
  const waServerUrl = process.env.WA_SERVER_URL || "http://localhost:4001";

  console.log(`[Direct-WA] Enviando mensaje a ${to} (Tenant: ${tenantId})...`);

  try {
    // Llamada directa al endpoint del bot que definimos en wa-server.js
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
      console.warn(`[Direct-WA] Error del bot: ${res.status} - ${errText}`);
    } else {
      console.log(`[Direct-WA] Mensaje enviado OK`);
    }
  } catch (e) {
    console.error(`[Direct-WA] Fallo de conexión con el bot (¿está corriendo?):`, e);
    // No lanzamos error para no romper el flujo principal de la app (ej: crear reserva)
  }
}