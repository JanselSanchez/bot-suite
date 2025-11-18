// worker/whatsappWorker.ts
import "dotenv/config";
import twilio from "twilio";
import { createWhatsappWorker } from "@/server/queue";
import type {
  WhatsappJobPayload,
  WhatsappEventType,
} from "@/server/whatsapp";

// ========= Config Twilio =========
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const from = process.env.TWILIO_WHATSAPP_FROM; // ej: "whatsapp:+14155238886"

if (!accountSid || !authToken || !from) {
  console.error(
    "[worker:whatsapp] Faltan variables TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM"
  );
}

const twilioClient =
  accountSid && authToken
    ? twilio(accountSid, authToken)
    : (null as unknown as ReturnType<typeof twilio>);

// ========= Plantillas internas por tipo =========

type TemplateVars = {
  [key: string]: any;
  customerName?: string;
  businessName?: string;
  message?: string;
  bookingTime?: string;
};

type TemplateRenderer = (vars: TemplateVars) => string;

const INTERNAL_TEMPLATES: Record<string, TemplateRenderer> = {
  // Plantilla genérica de bienvenida
  default_generic: (v) =>
    `Hola ${v.customerName ?? ""} 👋, te escribe ${
      v.businessName ?? "nuestro equipo"
    }. ${v.message ?? ""}`.trim(),

  // Cita creada
  default_booking_created: (v) =>
    `Hola ${v.customerName ?? ""} 👋, tu cita en ${
      v.businessName ?? "nuestro negocio"
    } fue agendada para ${
      v.bookingTime ?? "la fecha acordada"
    }. Si necesitas cambiarla responde a este mensaje.`,

  // Cita reprogramada
  default_booking_rescheduled: (v) =>
    `Hola ${v.customerName ?? ""} 👋, tu cita en ${
      v.businessName ?? "nuestro negocio"
    } fue reprogramada para ${
      v.bookingTime ?? "la nueva fecha"
    }. Si no puedes asistir, respóndenos por aquí.`,

  // Cita cancelada
  default_booking_cancelled: (v) =>
    `Hola ${v.customerName ?? ""} 👋, tu cita en ${
      v.businessName ?? "nuestro negocio"
    } ha sido cancelada. Si deseas agendar una nueva, responde a este mensaje.`,
};

/**
 * Devuelve el texto final a enviar, usando:
 *  1) body directo, si viene.
 *  2) templateKey + variables
 *  3) plantilla por defecto según event
 */
function buildBodyFromPayload(payload: WhatsappJobPayload): string | null {
  // 1) Si ya viene body directo, lo respetamos
  if (payload.body && payload.body.trim().length > 0) {
    return payload.body.trim();
  }

  const vars: TemplateVars = payload.variables ?? {};
  const key = payload.templateKey;

  // 2) Si hay templateKey explícito, usamos esa
  if (key && INTERNAL_TEMPLATES[key]) {
    return INTERNAL_TEMPLATES[key](vars);
  }

  // 3) Fall-back según tipo de evento
  const eventTemplateKey = getDefaultTemplateKeyForEvent(payload.event);
  const renderer = INTERNAL_TEMPLATES[eventTemplateKey];

  if (!renderer) return null;
  return renderer(vars);
}

function getDefaultTemplateKeyForEvent(event: WhatsappEventType): string {
  switch (event) {
    case "booking_created":
      return "default_booking_created";
    case "booking_rescheduled":
      return "default_booking_rescheduled";
    case "booking_cancelled":
      return "default_booking_cancelled";
    default:
      return "default_generic";
  }
}

// ========= Worker =========

const worker = createWhatsappWorker(async (job) => {
  const payload = job.data as WhatsappJobPayload;

  console.log("📨 JOB RECIBIDO:");
  console.log("  → id:", job.id);
  console.log("  → nombre:", job.name);
  console.log("  → data:", payload);

  if (!twilioClient || !from) {
    console.error("[worker:whatsapp] Twilio no está configurado correctamente.");
    throw new Error("Twilio client not configured");
  }

  const body = buildBodyFromPayload(payload);
  if (!body) {
    console.warn(
      "[worker:whatsapp] No se pudo construir el body del mensaje:",
      payload
    );
    return { ok: false, reason: "empty_body" };
  }

  if (!payload.to) {
    console.warn("[worker:whatsapp] Falta 'to' en payload:", payload);
    return { ok: false, reason: "missing_to" };
  }

  try {
    const msg = await twilioClient.messages.create({
      from,
      to: payload.to,
      body,
    });

    console.log("✅ Mensaje enviado por Twilio. SID:", msg.sid);
    return { ok: true, sid: msg.sid };
  } catch (err: any) {
    console.error(
      "[worker:whatsapp] Error enviando mensaje:",
      err?.message || err
    );
    throw err;
  }
});

if (!worker) {
  console.error(
    "❌ No se pudo iniciar el worker (no hay REDIS_URL o Redis no conecta)."
  );
} else {
  console.log("✅ Worker WhatsApp escuchando jobs en la cola 'whatsapp'...");
}
