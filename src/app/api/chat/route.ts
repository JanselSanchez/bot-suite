import { openai } from "@ai-sdk/openai";
import { streamText, convertToCoreMessages } from "ai";
// 1. CORRECCIÓN: Agregamos 'checkAvailabilityTool' y 'getServicesTool' a los imports
import { 
  createBookingTool, 
  getMyBookingsTool, 
  cancelBookingTool, 
  getServicesTool,       // <--- Faltaba esta
  checkAvailabilityTool  // <--- Faltaba esta (la del error)
} from "@/utils/booking-tools";

export const maxDuration = 60;

export async function POST(req: Request) {
  const { messages, data } = await req.json();

  const tenantId = data?.tenantId;
  const customerPhone = data?.customerPhone;
  const customerName = data?.customerName || "Cliente";

  if (!tenantId || !customerPhone) {
    return new Response("Falta información de contexto (tenantId o customerPhone)", { status: 400 });
  }

  const now = new Date().toLocaleString("es-DO", { 
    timeZone: "America/Santo_Domingo", 
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric' 
  });

  const systemPrompt = `
    ROL: Asistente virtual de ID: "${tenantId}".
    Cliente: "${customerName}" (Tel: ${customerPhone}).
    Hoy es: ${now}.

    TUS HERRAMIENTAS:
    1. **getServices**: Úsala SIEMPRE que pidan un servicio (corte, barba) para saber su ID y precio.
    2. **checkAvailability**: Úsala SIEMPRE que pidan horarios o disponibilidad.
    3. **createBooking**: Úsala SOLO cuando confirmen una hora específica.
       - Si ya buscaste el servicio, usa su ID.
       - Si no, envía serviceId: null.
    4. **getMyBookings / cancelBooking**: Para gestión.

    TONO: Profesional y breve.
  `;

  const result = await streamText({
    model: openai("gpt-4o"), 
    system: systemPrompt,
    messages: convertToCoreMessages(messages),
    
    // 2. CORRECCIÓN: Ahora que está importada arriba, ya no dará error aquí
    tools: {
      checkAvailability: checkAvailabilityTool as any, // <--- Nueva
      getServices: getServicesTool as any,             // <--- Nueva
      createBooking: createBookingTool as any,
      getMyBookings: getMyBookingsTool as any,
      cancelBooking: cancelBookingTool as any,
    },
    
    // @ts-ignore
    maxSteps: 10, 
  });

  return (result as any).toDataStreamResponse 
    ? (result as any).toDataStreamResponse() 
    : result.toTextStreamResponse();
}