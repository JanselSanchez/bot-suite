import { openai } from "@ai-sdk/openai";
import { streamText, convertToCoreMessages } from "ai";
import { createBookingTool, getMyBookingsTool, cancelBookingTool } from "@/utils/booking-tools";

export const maxDuration = 30;

export async function POST(req: Request) {
  // 1. Recibir los datos
  const { messages, data } = await req.json();

  const tenantId = data?.tenantId;
  const customerPhone = data?.customerPhone;
  const customerName = data?.customerName || "Cliente";

  if (!tenantId || !customerPhone) {
    return new Response("Falta información de contexto (tenantId o customerPhone)", { status: 400 });
  }

  // 2. Definir el "Ahora"
  const now = new Date().toLocaleString("es-DO", { 
    timeZone: "America/Santo_Domingo", 
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric' 
  });

  // 3. System Prompt
  const systemPrompt = `
    ROL: Asistente virtual de ID: "${tenantId}".
    Cliente: "${customerName}" (Tel: ${customerPhone}).
    Hoy es: ${now}.

    TOOLS: Tienes acceso a la base de datos para agendar/cancelar.

    REGLAS:
    1. Si eligen servicio, GUARDA el ID.
    2. Al agendar, usa 'createBooking' con 'serviceId', 'tenantId' y 'customerPhone'.
    3. Para reagendar: 'getMyBookings' -> 'cancelBooking' -> 'createBooking'.
    
    TONO: Profesional y breve.
  `;

  // 4. Ejecutar la IA
  const result = await streamText({
    model: openai("gpt-4o"), 
    system: systemPrompt,
    messages: convertToCoreMessages(messages),
    
    // Forzamos el tipado a 'any' para evitar conflictos de versiones en tus librerías
    tools: {
      createBooking: createBookingTool as any,
      getMyBookings: getMyBookingsTool as any,
      cancelBooking: cancelBookingTool as any,
    },
    
    // @ts-ignore  <--- ESTO IGNORA EL ERROR ROJO DE MAXSTEPS
    maxSteps: 5, 
  });

  // 5. Devolver respuesta
  // Usamos un cast a 'any' para evitar que TS se queje si tu versión de librería es vieja
  return (result as any).toDataStreamResponse 
    ? (result as any).toDataStreamResponse() 
    : result.toTextStreamResponse();
}