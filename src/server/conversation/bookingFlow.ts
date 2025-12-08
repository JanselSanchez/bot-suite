// src/app/server/conversation/bookingFlow.ts
//
// Flujo conversacional para AGENDAR citas.
//
// Esta capa NO sabe de WhatsApp, solo de:
// - tenantId, customerId
// - estado de la sesión (current_flow, step, payload)
// - un "evento" que viene de la capa de NLU/LLM (ej. SERVICE_PROVIDED, DATE_PROVIDED, etc.)
// - el BookingEngine para consultar/crear citas.
//
// La idea es:
//   1) Tu wa-server + NLU detectan qué evento pasó.
//   2) Llaman a handleBookingFlow(...).
//   3) Este módulo devuelve:
//        - nuevo estado (para guardar en conversation_sessions)
//        - mensaje de respuesta para el usuario
//        - y si se creó cita, datos de la booking.
//

import { AvailableSlot, BookingEngine } from "../booking";


export type BookingStep =
  | "SELECT_SERVICE"
  | "SELECT_DATE"
  | "SELECT_HOUR"
  | "DONE"
  | null;

export interface ConversationSessionState {
  current_flow: string | null;
  step: BookingStep;
  payload: any; // Debe ser JSON-serializable
}

export type BookingEventType =
  | "START_BOOKING"
  | "SERVICE_PROVIDED"
  | "DATE_PROVIDED"
  | "HOUR_PROVIDED"
  | "CANCEL_FLOW";

export interface BookingEvent {
  type: BookingEventType;

  // Texto original del usuario (por si quieres usarlo en prompts)
  text?: string;

  // SERVICE_PROVIDED
  serviceId?: string; // UUID del servicio

  // DATE_PROVIDED
  date?: string; // "YYYY-MM-DD" en zona local

  // HOUR_PROVIDED
  // O bien te llega el índice del slot mostrado (1, 2, 3...)
  slotIndex?: number;
  // O directamente una fecha/hora (si el LLM lo construyó)
  startLocal?: string; // ISO local: "2025-12-09T09:00:00"
}

export interface BookingFlowContext {
  tenantId: string;
  customerId: string;
  engine: BookingEngine;
  state: ConversationSessionState;
  event: BookingEvent;
}

export interface BookingCreated {
  id: string;
  tenantId: string;
  customerId: string;
  serviceId: string;
  startAt: string;
  endAt: string;
  status: string;
}

export interface BookingFlowResult {
  newState: ConversationSessionState;
  reply: string;
  bookingCreated?: BookingCreated;
  slotsShown?: AvailableSlot[];
  // Puedes añadir flags aquí si luego quieres analítica (ej. actionTaken: "CREATE_BOOKING")
}

/**
 * Maneja el flujo de agendar según el evento recibido.
 *
 * Este método NO toca la DB directo: delega en BookingEngine
 * y se limita a gestionar:
 *  - pasos
 *  - payload
 *  - mensaje para el usuario
 */
export async function handleBookingFlow(
  ctx: BookingFlowContext
): Promise<BookingFlowResult> {
  const { tenantId, customerId, engine, state, event } = ctx;

  // Clonamos el estado para no mutar el original
  const newState: ConversationSessionState = {
    current_flow: state.current_flow,
    step: state.step ?? null,
    payload: state.payload ? { ...state.payload } : {},
  };

  // Si llega un CANCEL_FLOW, reseteamos y salimos
  if (event.type === "CANCEL_FLOW") {
    newState.current_flow = null;
    newState.step = null;
    newState.payload = {};
    return {
      newState,
      reply: "Perfecto, cancelamos el proceso de agendar. Si quieres, lo intentamos de nuevo más tarde. 😊",
    };
  }

  // Aseguramos que el flujo esté marcado como BOOKING
  if (!newState.current_flow || event.type === "START_BOOKING") {
    newState.current_flow = "BOOKING";
  }

  switch (event.type) {
    case "START_BOOKING": {
      // Al iniciar, lo primero es tener el servicio
      newState.step = "SELECT_SERVICE";
      newState.payload = {};
      return {
        newState,
        reply:
          "Perfecto, vamos a agendar una cita. 💈\n\n¿Qué servicio quieres?\n1) Corte\n2) Barba\n3) Corte + Barba",
      };
    }

    case "SERVICE_PROVIDED": {
      if (!event.serviceId) {
        // Si por algún motivo el NLU falló, pedimos servicio de nuevo
        newState.step = "SELECT_SERVICE";
        return {
          newState,
          reply:
            "No me quedó claro el servicio. ¿Me recuerdas qué quieres?\nEjemplo: *corte*, *barba* o *corte + barba*.",
        };
      }

      newState.payload.serviceId = event.serviceId;
      newState.step = "SELECT_DATE";

      return {
        newState,
        reply:
          "Genial. ¿Para qué día quieres la cita? 📅\nPuedes decir: *hoy*, *mañana* o una fecha específica (ej. *10 de diciembre*).",
      };
    }

    case "DATE_PROVIDED": {
      const serviceId =
        newState.payload?.serviceId ?? event.serviceId;

      if (!serviceId) {
        // Sin servicio no podemos seguir. Volvemos al paso anterior.
        newState.step = "SELECT_SERVICE";
        return {
          newState,
          reply:
            "Antes de la fecha necesito saber el servicio. ¿Quieres corte, barba o corte + barba?",
        };
      }

      if (!event.date) {
        newState.step = "SELECT_DATE";
        return {
          newState,
          reply:
            "No pude entender la fecha. ¿Para qué día la quieres? Ejemplo: *hoy*, *mañana* o *10 de diciembre*.",
        };
      }

      newState.payload.serviceId = serviceId;
      newState.payload.date = event.date;

      // Llamamos al BookingEngine para consultar horarios
      const slots = await engine.findAvailableSlots({
        tenantId,
        serviceId,
        date: event.date,
      });

      if (!slots || slots.length === 0) {
        newState.step = "SELECT_DATE";
        return {
          newState,
          reply:
            "Ese día no tengo horarios disponibles. ¿Te sirve otro día? 📅",
        };
      }

      // Guardamos los slots en el payload para poder usarlos en HOUR_PROVIDED
      newState.payload.availableSlots = slots;
      newState.step = "SELECT_HOUR";

      const list = slots
        .map((slot, index) => `${index + 1}) ${slot.label}`)
        .join("\n");

      return {
        newState,
        reply:
          `Perfecto. Para ese día tengo estos horarios disponibles:\n\n${list}\n\n` +
          "Responde con el número del horario que prefieres (ej. *1* o *2*).",
        slotsShown: slots,
      };
    }

    case "HOUR_PROVIDED": {
      const serviceId = newState.payload?.serviceId;
      const date = newState.payload?.date;
      const availableSlots: AvailableSlot[] =
        newState.payload?.availableSlots ?? [];

      if (!serviceId || !date || availableSlots.length === 0) {
        // Algo se perdió del estado → reiniciamos el flujo
        newState.current_flow = "BOOKING";
        newState.step = "SELECT_SERVICE";
        newState.payload = {};
        return {
          newState,
          reply:
            "Parece que perdimos un dato de la cita. Vamos a intentarlo de nuevo. 🙏\n\n¿Qué servicio quieres agendar?",
        };
      }

      let chosenStartLocal: string | null = null;

      if (event.startLocal) {
        chosenStartLocal = event.startLocal;
      } else if (
        typeof event.slotIndex === "number" &&
        event.slotIndex >= 1 &&
        event.slotIndex <= availableSlots.length
      ) {
        chosenStartLocal =
          availableSlots[event.slotIndex - 1].startLocal;
      }

      if (!chosenStartLocal) {
        // No se entendió el horario
        const list = availableSlots
          .map((slot, index) => `${index + 1}) ${slot.label}`)
          .join("\n");
        newState.step = "SELECT_HOUR";
        return {
          newState,
          reply:
            `No entendí qué horario elegiste. 🤔\n\nEstos son los horarios disponibles:\n\n${list}\n\n` +
            "Responde con el número del horario que prefieres (ej. *1* o *2*).",
        };
      }

      // Intentamos crear la cita
      const result = await engine.createBooking({
        tenantId,
        customerId,
        serviceId,
        startLocal: chosenStartLocal,
      });

      if (!result.ok || !result.booking) {
        // Slot ya no disponible o error de DB
        const list = availableSlots
          .map((slot, index) => `${index + 1}) ${slot.label}`)
          .join("\n");

        // Mantenemos el paso en SELECT_HOUR para que el usuario elija otro
        newState.step = "SELECT_HOUR";

        return {
          newState,
          reply:
            `Ese horario ya no está disponible o hubo un error al crear la cita. 😔\n\n` +
            `Intenta elegir otro de los horarios disponibles:\n\n${list}`,
        };
      }

      // Cita creada correctamente
      newState.step = "DONE";
      // Puedes limpiar el flujo o dejar last_booking_id
      newState.current_flow = null;
      newState.payload = {
        last_booking_id: result.booking.id,
      };

      const booking = result.booking;
      const startDate = new Date(booking.startAt);

      const dateLabel = startDate.toLocaleDateString("es-DO", {
        weekday: "long",
        day: "2-digit",
        month: "short",
      });

      const timeLabel = startDate.toLocaleTimeString("es-DO", {
        hour: "2-digit",
        minute: "2-digit",
      });

      return {
        newState,
        reply:
          `Listo, tu cita quedó agendada. ✅\n\n` +
          `📅 *${dateLabel}* a las *${timeLabel}*.\n` +
          `Si más adelante quieres cambiarla o cancelarla, solo dime y lo hacemos por aquí. 😉`,
        bookingCreated: {
          id: booking.id,
          tenantId: booking.tenantId,
          customerId: booking.customerId,
          serviceId: booking.serviceId,
          startAt: booking.startAt,
          endAt: booking.endAt,
          status: booking.status,
        },
      };
    }

    default: {
      // Evento no reconocido → mantenemos el estado y pedimos aclaración
      return {
        newState,
        reply:
          "No entendí bien lo que quisiste hacer con tu cita. 😅\n" +
          "Puedes decirme algo como: *quiero agendar un corte para mañana*.",
      };
    }
  }
}
