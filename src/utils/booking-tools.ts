/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@supabase/supabase-js";
import { tool } from "ai";

// ------------------------------
// Supabase
// ------------------------------
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) throw new Error("Faltan credenciales Supabase");
const supabase = createClient(supabaseUrl, supabaseKey);

// ------------------------------
// Helpers
// ------------------------------
function toIso(d: Date) {
  return d.toISOString();
}

/**
 * Parse robusto para fechas:
 * - "2026-01-03" (día) -> lo tratamos como RD 00:00
 * - ISO válido -> new Date(iso)
 */
function parseDateInput(input: string): Date {
  // Si viene como YYYY-MM-DD, forzamos offset RD (-04:00)
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return new Date(`${input}T00:00:00-04:00`);
  }
  return new Date(input);
}

// Escape mínimo para ICS
function icsEscape(s: string) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

// --- HELPER: GENERADOR DE ICS ---
function generateICSContent(
  id: string,
  title: string,
  description: string,
  startISO: string,
  endISO: string
) {
  const formatDateICS = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const now = new Date();
  const start = new Date(startISO);
  const end = new Date(endISO);

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PymeBot//Agenda//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${icsEscape(id)}@pymebot.app`,
    `DTSTAMP:${formatDateICS(now)}`,
    `DTSTART:${formatDateICS(start)}`,
    `DTEND:${formatDateICS(end)}`,
    `SUMMARY:${icsEscape(title)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Recordatorio",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

// ------------------------------
// TOOLS (JSON Schema puro)
// ------------------------------

// 1) DISPONIBILIDAD
export const checkAvailabilityTool = tool({
  description: "Consulta horarios disponibles.",
  parameters: {
    type: "object",
    properties: {
      tenantId: { type: "string" },
      requestedDate: {
        type: "string",
        description: "Fecha YYYY-MM-DD",
      },
    },
    required: ["tenantId", "requestedDate"],
    additionalProperties: false,
  },
  execute: async (input: any) => {
    const { tenantId, requestedDate } = input;

    try {
      const date = parseDateInput(requestedDate);
      const dayOfWeek = date.getDay(); // 0=Dom ... 6=Sáb

      const { data: hours, error: hoursErr } = await supabase
        .from("business_hours")
        .select("open_time, close_time, is_closed")
        .eq("tenant_id", tenantId)
        .eq("dow", dayOfWeek)
        .maybeSingle();

      if (hoursErr) {
        return { available: false, message: "Error leyendo horarios: " + hoursErr.message };
      }

      if (!hours || hours.is_closed) {
        return { available: false, message: "Cerrado ese día." };
      }

      // Rango del día (RD)
      const startOfDay = new Date(`${requestedDate}T00:00:00-04:00`);
      const endOfDay = new Date(`${requestedDate}T23:59:59-04:00`);

      const { data: bookings, error: bErr } = await supabase
        .from("bookings")
        .select("starts_at, ends_at, status")
        .eq("tenant_id", tenantId)
        .in("status", ["confirmed", "pending"])
        .gte("starts_at", toIso(startOfDay))
        .lte("ends_at", toIso(endOfDay));

      if (bErr) {
        return { available: false, message: "Error leyendo reservas: " + bErr.message };
      }

      const slots: any[] = [];
      const [openH, openM] = String(hours.open_time).split(":").map(Number);
      const [closeH, closeM] = String(hours.close_time).split(":").map(Number);

      let cursor = new Date(`${requestedDate}T00:00:00-04:00`);
      cursor.setHours(openH, openM, 0, 0);

      const closeTime = new Date(`${requestedDate}T00:00:00-04:00`);
      closeTime.setHours(closeH, closeM, 0, 0);

      while (cursor < closeTime) {
        const slotEnd = new Date(cursor.getTime() + 60 * 60000);

        const isBusy = (bookings ?? []).some((b: any) => {
          const bStart = new Date(b.starts_at);
          const bEnd = new Date(b.ends_at);
          return cursor < bEnd && slotEnd > bStart;
        });

        if (!isBusy) {
          slots.push({
            label: cursor.toLocaleTimeString("es-DO", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
              timeZone: "America/Santo_Domingo",
            }),
            iso: cursor.toISOString(),
          });
        }

        cursor.setMinutes(cursor.getMinutes() + 30);
      }

      return { available: true, slots: slots.slice(0, 15) };
    } catch (e: any) {
      return { available: false, message: "Error verificando: " + e?.message };
    }
  },
});

// 2) SERVICIOS
export const getServicesTool = tool({
  description: "Busca servicios y precios.",
  parameters: {
    type: "object",
    properties: {
      tenantId: { type: "string" },
    },
    required: ["tenantId"],
    additionalProperties: false,
  },
  execute: async (input: any) => {
    const { tenantId } = input;

    try {
      const { data, error } = await supabase
        .from("items")
        .select("id, name, price_cents")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("name", { ascending: true })
        .limit(20);

      if (error) {
        return { services: [], message: "Error leyendo servicios: " + error.message };
      }

      const services =
        data?.map((i: any) => ({
          id: String(i.id),
          name: String(i.name),
          price: Number(i.price_cents ?? 0) / 100,
        })) ?? [];

      return { services };
    } catch (e: any) {
      return { services: [], message: "Error inesperado: " + e?.message };
    }
  },
});

// 3) CREAR CITA (CON ICS)
export const createBookingTool = tool({
  description: "Crea una nueva cita.",
  parameters: {
    type: "object",
    properties: {
      tenantId: { type: "string" },
      customerPhone: { type: "string" },
      customerName: { type: "string" },
      serviceId: { type: ["string", "null"] as any },
      startsAtISO: { type: "string", description: "Fecha inicio ISO 8601" },
      endsAtISO: { type: "string" },
      notes: { type: "string" },
    },
    required: ["tenantId", "customerPhone", "startsAtISO"],
    additionalProperties: false,
  },
  execute: async (input: any) => {
    const { tenantId, customerPhone, customerName, serviceId, startsAtISO, endsAtISO, notes } = input;

    try {
      const start = parseDateInput(startsAtISO);
      const end = endsAtISO ? parseDateInput(endsAtISO) : new Date(start.getTime() + 60 * 60000);

      const { data, error } = await supabase
        .from("bookings")
        .insert({
          tenant_id: tenantId,
          service_id: serviceId || null,
          customer_phone: customerPhone,
          customer_name: customerName || "Cliente",
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          status: "confirmed",
          notes: notes || "Agendado por IA",
        })
        .select("id, starts_at, ends_at")
        .single();

      if (error) throw error;

      const bookingId = String(data.id);
      const ics = generateICSContent(
        bookingId,
        "Cita Confirmada",
        `Reserva en ${tenantId}`,
        String(data.starts_at),
        String(data.ends_at)
      );

      return {
        success: true,
        message: "✅ Cita confirmada.",
        bookingId,
        startsAtISO: String(data.starts_at),
        endsAtISO: String(data.ends_at),
        icsData: ics,
      };
    } catch (e: any) {
      return { success: false, message: "Error al guardar: " + e.message, icsData: "" };
    }
  },
});

// 4) REAGENDAR (CON ICS)
export const rescheduleBookingTool = tool({
  description: "Reagenda una cita existente.",
  parameters: {
    type: "object",
    properties: {
      tenantId: { type: "string" },
      customerPhone: { type: "string" },
      newStartsAtISO: { type: "string", description: "Nueva fecha inicio ISO 8601" },
    },
    required: ["tenantId", "customerPhone", "newStartsAtISO"],
    additionalProperties: false,
  },
  execute: async (input: any) => {
    const { tenantId, customerPhone, newStartsAtISO } = input;

    try {
      const start = parseDateInput(newStartsAtISO);
      const end = new Date(start.getTime() + 60 * 60000);

      const { data: booking, error: findErr } = await supabase
        .from("bookings")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("customer_phone", customerPhone)
        .in("status", ["confirmed", "pending"])
        .order("starts_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (findErr) {
        return { success: false, message: "Error buscando cita: " + findErr.message, icsData: "" };
      }

      if (!booking) return { success: false, message: "No encontré cita para reagendar.", icsData: "" };

      const { error: updErr } = await supabase
        .from("bookings")
        .update({
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          status: "confirmed",
        })
        .eq("id", booking.id);

      if (updErr) throw updErr;

      const bookingId = String(booking.id);
      const ics = generateICSContent(
        bookingId,
        "Cita Reagendada",
        "Tu cita ha sido movida.",
        start.toISOString(),
        end.toISOString()
      );

      return {
        success: true,
        message: "✅ Cita reagendada.",
        bookingId,
        startsAtISO: start.toISOString(),
        endsAtISO: end.toISOString(),
        icsData: ics,
      };
    } catch (e: any) {
      return { success: false, message: "Error al reagendar: " + e.message, icsData: "" };
    }
  },
});

// 5) MIS CITAS
export const getMyBookingsTool = tool({
  description: "Busca citas futuras.",
  parameters: {
    type: "object",
    properties: {
      tenantId: { type: "string" },
      customerPhone: { type: "string" },
    },
    required: ["tenantId", "customerPhone"],
    additionalProperties: false,
  },
  execute: async (input: any) => {
    const { tenantId, customerPhone } = input;

    const { data, error } = await supabase
      .from("bookings")
      .select("id, starts_at, ends_at, status")
      .eq("tenant_id", tenantId)
      .eq("customer_phone", customerPhone)
      .in("status", ["confirmed", "pending"])
      .gt("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(10);

    if (error) return { found: false, bookings: [], message: error.message };
    return { found: !!data?.length, bookings: data ?? [] };
  },
});

// 6) CANCELAR
export const cancelBookingTool = tool({
  description: "Cancela cita.",
  parameters: {
    type: "object",
    properties: {
      tenantId: { type: "string" },
      customerPhone: { type: "string" },
    },
    required: ["tenantId", "customerPhone"],
    additionalProperties: false,
  },
  execute: async (input: any) => {
    const { tenantId, customerPhone } = input;

    const { data, error } = await supabase
      .from("bookings")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("customer_phone", customerPhone)
      .eq("status", "confirmed")
      .order("starts_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return { success: false, message: "Error buscando cita: " + error.message };
    if (!data) return { success: false, message: "No tienes citas activas." };

    const { error: updErr } = await supabase
      .from("bookings")
      .update({ status: "cancelled" })
      .eq("id", data.id);

    if (updErr) return { success: false, message: "Error cancelando: " + updErr.message };
    return { success: true, message: "Cita cancelada." };
  },
});
