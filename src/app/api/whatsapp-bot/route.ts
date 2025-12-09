import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { createBookingTool, getMyBookingsTool, cancelBookingTool } from "@/utils/booking-tools";

// Tipado del body que viene de tu servidor de WhatsApp
interface WhatsappBotRequestBody {
  tenantId: string;
  phoneNumber: string; 
  text: string;        
  customerName?: string; 
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as WhatsappBotRequestBody;
    const { tenantId, phoneNumber, text, customerName } = body;

    // 1. Validaciones básicas
    if (!tenantId || !phoneNumber || !text) {
      return NextResponse.json(
        { ok: false, message: "Faltan datos obligatorios (tenantId, phoneNumber, text)." },
        { status: 400 }
      );
    }

    // 2. Definir el "Ahora" para la IA
    const now = new Date().toLocaleString("es-DO", { 
      timeZone: "America/Santo_Domingo",
      dateStyle: "full",
      timeStyle: "short"
    });

    // 3. EL CEREBRO: Llamada a OpenAI con las Tools
    const { text: aiResponse, toolResults } = await generateText({
      model: openai("gpt-4o"), 
      system: `
        ROL:
        Eres el asistente virtual del negocio con ID: "${tenantId}".
        Estás hablando con el cliente: "${customerName || 'Usuario'}" (Tel: ${phoneNumber}).
        
        CONTEXTO TEMPORAL:
        Hoy es: ${now}.
        Usa esta fecha para calcular referencias relativas (mañana, el viernes, etc).

        TUS HERRAMIENTAS:
        Tienes acceso directo a la base de datos para Agendar, Cancelar y Consultar citas.
        
        REGLAS DE ORO:
        1. ID DEL SERVICIO: Si el usuario menciona un servicio, GUARDA mentalmente cuál es.
        2. AL AGENDAR: Usa la herramienta 'createBooking'. Debes pasar el 'serviceId' correcto. Si no sabes cuál es, pregunta.
        3. AL CANCELAR: Primero usa 'getMyBookings' para ver qué tiene, luego 'cancelBooking'.
        
        TONO:
        Amable, breve y profesional.
      `,
      prompt: text, 
      
      // Forzamos 'as any' para evitar conflictos de versiones de TS
      tools: {
        createBooking: createBookingTool as any,
        getMyBookings: getMyBookingsTool as any,
        cancelBooking: cancelBookingTool as any,
      },
      
      // @ts-ignore
      maxSteps: 5, 
    });

    // 4. Preparar la respuesta para el servidor de WhatsApp
    let icsData: string | null = null;
    
    if (toolResults) {
      for (const tool of toolResults) {
        // CORRECCIÓN FINAL: Casteamos 'tool' a 'any' para acceder a .result sin que TS llore
        const t = tool as any;
        
        if (t.toolName === 'createBooking' && t.result?.icsData) {
           icsData = t.result.icsData; 
        }
      }
    }

    // 5. Devolver JSON al wa-server
    return NextResponse.json({
      ok: true,
      reply: aiResponse, 
      icsData: icsData   
    });

  } catch (error: any) {
    console.error("[/api/whatsapp-bot] Error:", error);
    return NextResponse.json(
      { ok: false, message: "Error interno del bot." },
      { status: 500 }
    );
  }
}

// Bloquear GET
export function GET() {
  return NextResponse.json({ ok: false, message: "Method not allowed" }, { status: 405 });
}