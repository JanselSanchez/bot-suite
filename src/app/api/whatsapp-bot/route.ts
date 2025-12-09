import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { 
  createBookingTool, 
  getMyBookingsTool, 
  cancelBookingTool, 
  getServicesTool, 
  checkAvailabilityTool 
} from "@/utils/booking-tools";

interface WhatsappBotRequestBody {
  tenantId: string;
  phoneNumber: string; 
  text: string;        
  customerName?: string; 
}

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as WhatsappBotRequestBody;
    const { tenantId, phoneNumber, text, customerName } = body;

    if (!tenantId || !phoneNumber || !text) {
      return NextResponse.json({ ok: false, message: "Faltan datos." }, { status: 400 });
    }

    const now = new Date().toLocaleString("es-DO", { 
      timeZone: "America/Santo_Domingo",
      dateStyle: "full",
      timeStyle: "short"
    });

    const { text: aiResponse, toolResults } = await generateText({
      model: openai("gpt-4o"), 
      system: `
        ROL: Asistente de reservas de "${tenantId}". Cliente: ${customerName} (${phoneNumber}). FECHA: ${now}.

        OBJETIVO: CERRAR LA CITA Y MANDAR EL ARCHIVO.

        REGLAS DE ORO (MODO VENTAS):
        1. **CATÁLOGO:** Si preguntan precios, usa 'getServices'.
        2. **DISPONIBILIDAD:** Si preguntan "¿qué horas tienes?", usa 'checkAvailability'.
        3. **AGENDAR (PRIORIDAD MÁXIMA):**
           - Si el cliente dice "Agéndame a las 3", HAZLO DE INMEDIATO.
           - Intenta buscar el ID del servicio con 'getServices' internamente.
           - **SI NO ENCUENTRAS EL ID:** No importa. Llama a 'createBooking' enviando 'serviceId': null.
           - **NUNCA** digas "no tengo información del servicio". AGENDA IGUAL.

        4. **CONFIRMACIÓN:**
           - Cuando 'createBooking' responda "success", di solo: "Listo, cita confirmada. Aquí tienes tu recordatorio."

        TONO: Seguro y eficiente.
      `,
      prompt: text, 
      
      tools: {
        getServices: getServicesTool as any,
        checkAvailability: checkAvailabilityTool as any,
        createBooking: createBookingTool as any,
        getMyBookings: getMyBookingsTool as any,
        cancelBooking: cancelBookingTool as any,
      },
      
      // @ts-ignore
      maxSteps: 8, 
    });

    let icsData: string | null = null;
    if (toolResults) {
      for (const tool of toolResults) {
        const t = tool as any;
        if (t.toolName === 'createBooking' && t.result?.icsData) {
           icsData = t.result.icsData; 
        }
      }
    }

    return NextResponse.json({ ok: true, reply: aiResponse, icsData: icsData });

  } catch (error: any) {
    console.error("[/api/whatsapp-bot] Error:", error);
    return NextResponse.json(
      { ok: false, message: "Error: " + error.message },
      { status: 500 }
    );
  }
}

export function GET() {
  return NextResponse.json({ ok: false, message: "Method not allowed" }, { status: 405 });
}