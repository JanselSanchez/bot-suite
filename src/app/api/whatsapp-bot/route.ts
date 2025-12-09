import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { 
  createBookingTool, 
  getMyBookingsTool, 
  cancelBookingTool, 
  getServicesTool, 
  checkAvailabilityTool,
  rescheduleBookingTool // <--- IMPORTAMOS LA NUEVA
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

    const now = new Date().toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "full", timeStyle: "short" });

    const { text: aiResponse, toolResults } = await generateText({
      model: openai("gpt-4o"), 
      system: `
        ROL: Asistente de reservas "${tenantId}". Cliente: ${customerName} (${phoneNumber}). FECHA: ${now}.
        
        OBJETIVO: CONCRETAR LA ACCIÓN Y MANDAR EL ARCHIVO.

        REGLAS:
        1. **PRECIOS:** Usa 'getServices'.
        2. **HORARIOS:** Usa 'checkAvailability'.
        3. **AGENDAR (Nuevo):** Usa 'createBooking'. (Si no sabes serviceId, manda null).
        4. **REAGENDAR (Cambio):** Usa 'rescheduleBooking'.
        5. **CANCELAR:** Usa 'cancelBooking'.

        CONFIRMACIÓN:
        - Si la herramienta funciona (success: true), di solo: "Listo, cambio realizado. Aquí tienes el recordatorio."
      `,
      prompt: text, 
      
      tools: {
        getServices: getServicesTool as any,
        checkAvailability: checkAvailabilityTool as any,
        createBooking: createBookingTool as any,
        rescheduleBooking: rescheduleBookingTool as any, // <--- REGISTRADA
        getMyBookings: getMyBookingsTool as any,
        cancelBooking: cancelBookingTool as any,
      },
      
      // @ts-ignore
      maxSteps: 8, 
    });

    // --- MAGIA DEL ARCHIVO ICS ---
    let icsData: string | null = null;
    if (toolResults) {
      for (const tool of toolResults) {
        const t = tool as any;
        // Ahora buscamos el archivo en createBooking O en rescheduleBooking
        if ((t.toolName === 'createBooking' || t.toolName === 'rescheduleBooking') && t.result?.icsData) {
           icsData = t.result.icsData; 
        }
      }
    }

    return NextResponse.json({ ok: true, reply: aiResponse, icsData: icsData });

  } catch (error: any) {
    console.error("[/api/whatsapp-bot] Error:", error);
    return NextResponse.json({ ok: false, message: "Error: " + error.message }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ ok: false, message: "Method not allowed" }, { status: 405 });
}