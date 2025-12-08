// src/app/api/whatsapp-bot/route.ts
//
// Endpoint central para manejar la lógica del bot desde WhatsApp.
//
// El servidor de WhatsApp (wa-server.js) hará un POST a esta ruta
// enviando:
//  - tenantId
//  - customerId
//  - phoneNumber
//  - text (mensaje original del usuario)
//  - state: { current_flow, step, payload }
//  - event: BookingEvent (type, serviceId, date, slotIndex, startLocal, etc.)
//
// Este endpoint:
//
//  1) Crea el Supabase client (server-side).
//  2) Crea el BookingEngine.
//  3) Llama a handleBookingFlow(...) para el flujo de AGENDAR.
//  4) Devuelve:
//      - reply (texto para enviar por WhatsApp)
//      - newState (nuevo current_flow, step, payload)
//      - bookingCreated (si se creó cita)
//      - slotsShown (si se listaron horarios)
//
// Más adelante puedes ampliar para manejar otros flujos (reagendar/cancelar)
// en este mismo endpoint o separarlos en otros.
//

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { BookingEngine } from "@/server/booking";
import {
  handleBookingFlow,
  type BookingFlowResult,
  type ConversationSessionState,
  type BookingEvent,
} from "@/server/conversation/bookingFlow";

// Tipado del body esperado desde wa-server
interface WhatsappBotRequestBody {
  tenantId: string;
  customerId: string;
  phoneNumber: string;
  text: string;

  state: ConversationSessionState;

  // Evento ya interpretado por tu capa NLU/LLM
  event: BookingEvent;
}

function getSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno del servidor."
    );
  }

  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const json = (await req.json()) as WhatsappBotRequestBody;

    const { tenantId, customerId, phoneNumber, text, state, event } = json;

    if (!tenantId || !customerId || !phoneNumber) {
      return NextResponse.json(
        {
          ok: false,
          error: "missing_identifiers",
          message:
            "Faltan tenantId, customerId o phoneNumber en la petición a /api/whatsapp-bot.",
        },
        { status: 400 }
      );
    }

    // Creamos el Supabase client admin (server-side, con service role)
    const supabase = getSupabaseAdminClient();

    // Creamos el motor de agenda
    const bookingEngine = new BookingEngine(supabase, {
      timeZone: "America/Santo_Domingo",
      blockingStatuses: ["confirmed", "pending"],
    });

    // Construimos el contexto para el flujo de booking
    const flowResult: BookingFlowResult = await handleBookingFlow({
      tenantId,
      customerId,
      engine: bookingEngine,
      state: {
        current_flow: state.current_flow ?? null,
        step: state.step ?? null,
        payload: state.payload ?? {},
      },
      event: {
        ...event,
        text, // por si quieres usarlo en el futuro
      },
    });

    // Devolvemos todo lo que el wa-server necesita:
    //  - reply -> mensaje para enviar por WhatsApp
    //  - newState -> para actualizar conversation_sessions
    //  - bookingCreated, slotsShown -> opcional, por si quieres loggear
    return NextResponse.json(
      {
        ok: true,
        reply: flowResult.reply,
        newState: flowResult.newState,
        bookingCreated: flowResult.bookingCreated ?? null,
        slotsShown: flowResult.slotsShown ?? [],
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[/api/whatsapp-bot] Error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "internal_error",
        message: error?.message ?? "Error interno en /api/whatsapp-bot.",
      },
      { status: 500 }
    );
  }
}

// Opcional: bloquear otros métodos HTTP
export function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: "method_not_allowed",
      message: "Usa POST para interactuar con /api/whatsapp-bot.",
    },
    { status: 405 }
  );
}
