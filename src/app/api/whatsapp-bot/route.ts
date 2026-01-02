import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { createClient } from "@supabase/supabase-js";

// ✅ Usar factorías (make...) para inyectar tenantId/phone y evitar errores
import {
  makeCheckAvailabilityTool,
  makeGetServicesTool,
  makeCreateBookingTool,
  makeRescheduleBookingTool,
  makeGetMyBookingsTool,
  makeCancelBookingTool,
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

// ------------------------------
// Helpers: toolResults parsing
// ------------------------------
function safeJsonParse(v: any) {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

type BookingMeta = {
  action: "created" | "rescheduled";
  bookingId: string;
  startsAtISO?: string | null;
  endsAtISO?: string | null;
};

function extractBookingMeta(toolResults: any): BookingMeta | null {
  if (!Array.isArray(toolResults)) return null;

  let meta: BookingMeta | null = null;

  for (const tr of toolResults) {
    const t: any = tr;

    const toolName = t?.toolName || t?.name || t?.tool || null;
    if (toolName !== "createBooking" && toolName !== "rescheduleBooking") continue;

    // AI SDK a veces entrega result como objeto, a veces como string JSON
    const result = safeJsonParse(t?.result);

    // A veces el result viene envuelto: { ok:true, data: {...} } o { result: {...} }
    const r0 = result?.result ?? result;
    const r1 = r0?.data ?? r0;

    const bookingId =
      r1?.bookingId ||
      r1?.booking_id ||
      r1?.id ||
      r1?.booking?.id ||
      r0?.bookingId ||
      r0?.booking_id ||
      r0?.id ||
      r0?.booking?.id ||
      null;

    const startsAtISO =
      r1?.startsAtISO ||
      r1?.starts_at ||
      r1?.booking?.starts_at ||
      r0?.startsAtISO ||
      r0?.starts_at ||
      r0?.booking?.starts_at ||
      null;

    const endsAtISO =
      r1?.endsAtISO ||
      r1?.ends_at ||
      r1?.booking?.ends_at ||
      r0?.endsAtISO ||
      r0?.ends_at ||
      r0?.booking?.ends_at ||
      null;

    if (bookingId) {
      meta = {
        action: toolName === "createBooking" ? "created" : "rescheduled",
        bookingId: String(bookingId),
        startsAtISO: startsAtISO ? String(startsAtISO) : null,
        endsAtISO: endsAtISO ? String(endsAtISO) : null,
      };
    }
  }

  return meta;
}

function extractIcsData(toolResults: any): string | null {
  if (!Array.isArray(toolResults)) return null;

  for (const tr of toolResults) {
    const t: any = tr;
    const toolName = t?.toolName || t?.name || t?.tool || null;
    if (toolName !== "createBooking" && toolName !== "rescheduleBooking") continue;

    const result = safeJsonParse(t?.result);
    const r0 = result?.result ?? result;
    const r1 = r0?.data ?? r0;

    // icsData puede venir en varias ubicaciones
    const ics = r1?.icsData || r0?.icsData || result?.icsData || null;

    if (ics) return String(ics);
  }

  return null;
}

// ------------------------------
// Route
// ------------------------------
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as WhatsappBotRequestBody;
    const { tenantId, phoneNumber, text, customerName } = body;

    // 1. Validación básica
    if (!tenantId || !phoneNumber || !text) {
      return NextResponse.json(
        { ok: false, message: "Faltan datos (tenantId, phoneNumber, text)." },
        { status: 400 }
      );
    }

    // 2. 🔥 CEREBRO DINÁMICO: Buscar identidad del negocio en la DB 🔥
    const { data: profile } = await supabase
      .from("business_profiles")
      .select("*")
      .eq("tenant_id", tenantId)
      .single();

    // Valores por defecto si no se ha configurado el perfil aún
    const botName = profile?.bot_name || "Asistente Virtual";
    const botTone = profile?.bot_tone || "Amable y profesional";
    const customRules =
      profile?.custom_instructions || "Ayuda al cliente a agendar citas.";

    // Fecha y hora local de RD
    const now = new Date().toLocaleString("es-DO", {
      timeZone: "America/Santo_Domingo",
      dateStyle: "full",
      timeStyle: "short",
    });

    // ✅ 3) Crear tools ya “inyectadas” con tenantId/phone para que la IA no invente esos campos
    const tools = {
      getServices: makeGetServicesTool(tenantId) as any,
      checkAvailability: makeCheckAvailabilityTool(tenantId) as any,
      createBooking: makeCreateBookingTool(tenantId, phoneNumber, customerName) as any,
      rescheduleBooking: makeRescheduleBookingTool(tenantId, phoneNumber) as any,
      getMyBookings: makeGetMyBookingsTool(tenantId, phoneNumber) as any,
      cancelBooking: makeCancelBookingTool(tenantId, phoneNumber) as any,
    };

    // 4. Invocamos a la IA con la identidad cargada
    const { text: aiResponse, toolResults } = await generateText({
      model: openai("gpt-4o"), // o gpt-4o-mini
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
- Cuando el usuario quiera agendar/reagendar, SIEMPRE llama la herramienta correspondiente.
- Si usas 'createBooking' o 'rescheduleBooking' con éxito, responde confirmando y di: "Te he enviado el archivo de calendario."
- Sé conciso. No inventes información que no esté en las herramientas.
      `.trim(),
      prompt: text,
      tools,
      // @ts-ignore
      maxSteps: 8,
    });

    // 5. --- ICS + BookingMeta (a prueba de fallos) ---
    const icsData: string | null = extractIcsData(toolResults);
    const bookingMeta: BookingMeta | null = extractBookingMeta(toolResults);

    // 6. Respuesta a n8n / wa-server
    return NextResponse.json({
      ok: true,
      reply: aiResponse,
      icsData,
      bookingMeta,
    });
  } catch (error: any) {
    console.error("[/api/whatsapp-bot] Error crítico:", error);
    return NextResponse.json(
      { ok: false, message: "Error interno: " + (error?.message || String(error)) },
      { status: 500 }
    );
  }
}

export function GET() {
  return NextResponse.json(
    { ok: false, message: "Method not allowed. Use POST." },
    { status: 405 }
  );
}
