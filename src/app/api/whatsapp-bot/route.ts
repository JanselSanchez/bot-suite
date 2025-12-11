import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { createClient } from "@supabase/supabase-js"; // 👈 NECESARIO PARA LEER LA DB

// Importamos tus herramientas (Asegúrate de que la ruta sea correcta)
import { 
  createBookingTool, 
  getMyBookingsTool, 
  cancelBookingTool, 
  getServicesTool, 
  checkAvailabilityTool,
  rescheduleBookingTool 
} from "@/utils/booking-tools";

// Inicializar Supabase para leer el perfil del negocio dinámicamente
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface WhatsappBotRequestBody {
  tenantId: string;
  phoneNumber: string; 
  text: string;        
  customerName?: string; 
}

// Permitir hasta 60 segundos de ejecución (vital para la IA)
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as WhatsappBotRequestBody;
    const { tenantId, phoneNumber, text, customerName } = body;

    // 1. Validación básica
    if (!tenantId || !phoneNumber || !text) {
      return NextResponse.json({ ok: false, message: "Faltan datos (tenantId, phone, text)." }, { status: 400 });
    }

    // 2. 🔥 CEREBRO DINÁMICO: Buscar identidad del negocio en la DB 🔥
    // Aquí es donde ocurre la magia Multi-Tenant.
    const { data: profile } = await supabase
      .from("business_profiles")
      .select("*")
      .eq("tenant_id", tenantId)
      .single();

    // Valores por defecto si no se ha configurado el perfil aún
    const botName = profile?.bot_name || "Asistente Virtual";
    const botTone = profile?.bot_tone || "Amable y profesional";
    const customRules = profile?.custom_instructions || "Ayuda al cliente a agendar citas.";
    
    // Fecha y hora local de RD para que la IA sepa "cuándo es hoy"
    const now = new Date().toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "full", timeStyle: "short" });

    // 3. Invocamos a la IA con la identidad cargada
    const { text: aiResponse, toolResults } = await generateText({
      model: openai("gpt-4o"), // O "gpt-4o-mini" si quieres ahorrar
      
      // Inyectamos la identidad dinámica aquí 👇
      system: `
        ROL: Eres "${botName}". Actúa con un tono ${botTone}.
        CONTEXTO: Trabajas para el negocio con ID "${tenantId}".
        FECHA Y HORA ACTUAL: ${now}.
        CLIENTE: ${customerName || "Usuario"} (${phoneNumber}).

        REGLAS DEL NEGOCIO (SÍGUELAS AL PIE DE LA LETRA):
        "${customRules}"

        HERRAMIENTAS DISPONIBLES:
        1. **PRECIOS/SERVICIOS:** Usa 'getServices'.
        2. **DISPONIBILIDAD:** Usa 'checkAvailability'.
        3. **AGENDAR:** Usa 'createBooking'. (Si no sabes serviceId, envía null).
        4. **REAGENDAR:** Usa 'rescheduleBooking'.
        5. **CANCELAR:** Usa 'cancelBooking'.
        6. **MIS CITAS:** Usa 'getMyBookings'.

        INSTRUCCIONES IMPORTANTES:
        - Si usas 'createBooking' o 'rescheduleBooking' con éxito, responde confirmando y di: "Te he enviado el archivo de calendario."
        - Sé conciso. No inventes información que no esté en las herramientas.
      `,
      
      prompt: text, 
      
      // Conectamos las herramientas reales que modifican la DB
      tools: {
        getServices: getServicesTool as any,
        checkAvailability: checkAvailabilityTool as any,
        createBooking: createBookingTool as any,
        rescheduleBooking: rescheduleBookingTool as any,
        getMyBookings: getMyBookingsTool as any,
        cancelBooking: cancelBookingTool as any,
      },
      
      // @ts-ignore
      maxSteps: 8, // Permitimos varios pasos (ej: buscar hora -> agendar)
    });

    // 4. --- MAGIA DEL ARCHIVO ICS ---
    // Revisamos si alguna herramienta generó un archivo de calendario
    let icsData: string | null = null;
    
    if (toolResults) {
      for (const tool of toolResults) {
        const t = tool as any;
        // Buscamos icsData en la respuesta de crear o reagendar
        if ((t.toolName === 'createBooking' || t.toolName === 'rescheduleBooking') && t.result?.icsData) {
           icsData = t.result.icsData; 
        }
      }
    }

    // 5. Devolvemos la respuesta al Servidor de WhatsApp (wa-server)
    return NextResponse.json({ 
        ok: true, 
        reply: aiResponse, 
        icsData: icsData // Si hay archivo, se envía aquí
    });

  } catch (error: any) {
    console.error("[/api/whatsapp-bot] Error crítico:", error);
    return NextResponse.json({ ok: false, message: "Error interno: " + error.message }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ ok: false, message: "Method not allowed. Use POST." }, { status: 405 });
}