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
        ROL: Eres el asistente de reservas del negocio "${tenantId}".
        CLIENTE: ${customerName || 'Usuario'} (Tel: ${phoneNumber}).
        FECHA: ${now}.

        OBJETIVO ÚNICO: CONCRETAR LA CITA Y MANDAR EL ARCHIVO.

        REGLAS DE COMPORTAMIENTO (MODO AGRESIVO):
        1. **PRIORIDAD MÁXIMA: AGENDAR.**
           - Si el cliente dice una hora ("quiero a las 3"), intenta agendar DE INMEDIATO.
           - No des vueltas preguntando detalles innecesarios.

        2. **SOBRE EL SERVICIO (ID):**
           - Intenta buscar el servicio con 'getServices' rápido.
           - **IMPORTANTE:** Si NO encuentras el servicio o el cliente no fue específico, **NO TE DETENGAS**.
           - Llama a 'createBooking' enviando 'serviceId': null.
           - Es mejor guardar una cita "sin servicio especificado" que perder al cliente.

        3. **SOBRE LA DISPONIBILIDAD:**
           - Si el cliente pregunta "¿qué horas tienes?", usa 'checkAvailability'.
           - Si el cliente dice "Agéndame a las 4", usa 'createBooking' directamente. Si la base de datos rebota por horario ocupado, entonces ofrécele otros horarios.

        4. **CONFIRMACIÓN:**
           - Una vez ejecutes 'createBooking' y salga exitoso ("success: true"), dile al cliente: "Listo, cita confirmada. Aquí tienes tu recordatorio." y no digas nada más que pueda confundirlo.

        TONO: Seguro, eficiente y servicial.
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

    // Detectar si se generó el archivo de calendario
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
      { ok: false, message: "Error interno: " + error.message },
      { status: 500 }
    );
  }
}

export function GET() {
  return NextResponse.json({ ok: false, message: "Method not allowed" }, { status: 405 });
}