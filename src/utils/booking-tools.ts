/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { tool } from "ai";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Faltan credenciales Supabase");
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ------------------------------------------------------
// HELPERS
// ------------------------------------------------------

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
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${id}@pymebot.app`,
    `DTSTAMP:${formatDateICS(now)}`,
    `DTSTART:${formatDateICS(start)}`,
    `DTEND:${formatDateICS(end)}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description}`,
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

function parseYMD(dateStr: string) {
  // Evita bugs de timezone: crea fecha local 00:00 del día pedido
  // dateStr esperado: YYYY-MM-DD
  const [y, m, d] = (dateStr || "").split("-").map((n) => Number(n));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/**
 * Mapeo seguro de DOW:
 * - si tu DB guarda dow como 0-6 (Dom-Sáb) => usamos getDay() directo
 * - si tu DB guarda dow como 1-7 (Lun-Dom) => convertimos
 *
 * Como no puedo ver tu DB aquí, lo hacemos robusto:
 * buscamos primero con 0-6; si no hay, intentamos 1-7.
 */
async function getBusinessHoursForDate(tenantId: string, dateLocal0: Date) {
  const dow0_6 = dateLocal0.getDay(); // 0=Dom ... 6=Sáb

  // Intento #1: DB con 0-6
  const a = await supabase
    .from("business_hours")
    .select("open_time, close_time, is_closed, dow")
    .eq("tenant_id", tenantId)
    .eq("dow", dow0_6)
    .maybeSingle();

  if (a.data) return a.data;

  // Intento #2: DB con 1-7 (Lun=1 ... Dom=7)
  const dow1_7 = dow0_6 === 0 ? 7 : dow0_6; // Dom(0)->7, Lun(1)->1, ...
  const b = await supabase
    .from("business_hours")
    .select("open_time, close_time, is_closed, dow")
    .eq("tenant_id", tenantId)
    .eq("dow", dow1_7)
    .maybeSingle();

  return b.data ?? null;
}

function safeTimeParts(t: string) {
  const [h, m] = String(t || "00:00")
    .split(":")
    .slice(0, 2)
    .map((x) => Number(x));
  return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 };
}

function fmtMoneyRD(value: number) {
  // si usas USD, cámbialo. Esto es solo visual.
  return new Intl.NumberFormat("es-DO", {
    style: "currency",
    currency: "DOP",
    maximumFractionDigits: 0,
  }).format(value);
}

// ------------------------------------------------------
// ✅ FACTORÍA DE TOOLS (FIX DEFINITIVO)
// Inyecta tenantId/phone desde el backend.
// La IA ya NO necesita pasar tenantId/customerPhone (menos fallos).
// ------------------------------------------------------

export function makeCheckAvailabilityTool(tenantId: string) {
  return tool({
    description: "Consulta horarios disponibles.",
    parameters: z.object({
      requestedDate: z.string().describe("Fecha YYYY-MM-DD"),
    }),
    execute: async (input: any) => {
      const { requestedDate } = input ?? {};
      try {
        const dateLocal0 = parseYMD(requestedDate);
        if (!dateLocal0) {
          return { available: false, message: "Fecha inválida. Usa YYYY-MM-DD." };
        }

        const hours = await getBusinessHoursForDate(tenantId, dateLocal0);
        if (!hours || hours.is_closed || !hours.open_time || !hours.close_time) {
          return { available: false, message: "Cerrado ese día." };
        }

        const startOfDay = new Date(dateLocal0);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(dateLocal0);
        endOfDay.setHours(23, 59, 59, 999);

        const { data: bookings } = await supabase
          .from("bookings")
          .select("starts_at, ends_at")
          .eq("tenant_id", tenantId)
          .in("status", ["confirmed", "pending"])
          .gte("starts_at", startOfDay.toISOString())
          .lte("ends_at", endOfDay.toISOString());

        const slots: any[] = [];
        const { h: openH, m: openM } = safeTimeParts(hours.open_time);
        const { h: closeH, m: closeM } = safeTimeParts(hours.close_time);

        const cursor = new Date(dateLocal0);
        cursor.setHours(openH, openM, 0, 0);

        const closeTime = new Date(dateLocal0);
        closeTime.setHours(closeH, closeM, 0, 0);

        // Slots de 30 min, duración de cita 60 min (como tenías)
        while (cursor < closeTime) {
          const slotEnd = new Date(cursor.getTime() + 60 * 60000);

          // si el slot se pasa del cierre, paramos
          if (slotEnd > closeTime) break;

          const isBusy = (bookings || []).some((b: any) => {
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
              }),
              iso: cursor.toISOString(),
            });
          }

          cursor.setMinutes(cursor.getMinutes() + 30);
        }

        return { available: true, slots: slots.slice(0, 15) };
      } catch (e: any) {
        return { available: false, message: "Error verificando: " + (e?.message || "") };
      }
    },
  } as any);
}

export function makeGetServicesTool(tenantId: string) {
  return tool({
    description: "Busca servicios y precios.",
    parameters: z.object({}),
    execute: async () => {
      try {
        const { data } = await supabase
          .from("items")
          .select("id, name, price_cents, description")
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .order("name", { ascending: true })
          .limit(10);

        const services =
          data?.map((i: any) => ({
            id: i.id,
            name: i.name,
            price: typeof i.price_cents === "number" ? i.price_cents / 100 : null,
            priceLabel:
              typeof i.price_cents === "number"
                ? fmtMoneyRD(i.price_cents / 100)
                : null,
            description: i.description || null,
          })) || [];

        return { services };
      } catch {
        return { services: [] };
      }
    },
  } as any);
}

export function makeCreateBookingTool(
  tenantId: string,
  customerPhone: string,
  customerName?: string
) {
  return tool({
    description: "Crea una nueva cita.",
    parameters: z.object({
      serviceId: z.string().optional().nullable(),
      startsAtISO: z.string().describe("Fecha inicio ISO 8601"),
      endsAtISO: z.string().optional(),
      notes: z.string().optional(),
    }),
    execute: async (input: any) => {
      const { serviceId, startsAtISO, endsAtISO, notes } = input ?? {};

      const start = new Date(startsAtISO);
      if (isNaN(start.getTime())) {
        return { success: false, message: "Fecha/hora inválida.", icsData: "" };
      }

      const end = endsAtISO ? new Date(endsAtISO) : new Date(start.getTime() + 60 * 60000);
      if (isNaN(end.getTime())) {
        return { success: false, message: "Hora de fin inválida.", icsData: "" };
      }

      try {
        const { data, error } = await supabase
          .from("bookings")
          .insert({
            tenant_id: tenantId,
            service_id: serviceId || null,
            customer_phone: customerPhone,
            customer_name: customerName || "Cliente Web",
            starts_at: start.toISOString(),
            ends_at: end.toISOString(),
            status: "confirmed",
            notes: notes || "Agendado por IA",
          })
          .select("id")
          .single();

        if (error) throw error;

        const ics = generateICSContent(
          data.id,
          "Cita Confirmada",
          `Reserva en ${tenantId}`,
          start.toISOString(),
          end.toISOString()
        );

        return { success: true, message: "✅ Cita confirmada.", bookingId: data.id, icsData: ics };
      } catch (e: any) {
        return { success: false, message: "Error al guardar: " + e.message, icsData: "" };
      }
    },
  } as any);
}

export function makeRescheduleBookingTool(
  tenantId: string,
  customerPhone: string
) {
  return tool({
    description: "Reagenda una cita existente.",
    parameters: z.object({
      newStartsAtISO: z.string().describe("Nueva fecha inicio ISO 8601"),
      newEndsAtISO: z.string().optional(),
    }),
    execute: async (input: any) => {
      const { newStartsAtISO, newEndsAtISO } = input ?? {};

      const start = new Date(newStartsAtISO);
      if (isNaN(start.getTime())) {
        return { success: false, message: "Fecha/hora inválida.", icsData: "" };
      }
      const end = newEndsAtISO ? new Date(newEndsAtISO) : new Date(start.getTime() + 60 * 60000);

      try {
        const { data: booking } = await supabase
          .from("bookings")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("customer_phone", customerPhone)
          .in("status", ["confirmed", "pending"])
          .order("starts_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!booking) {
          return { success: false, message: "No encontré cita para reagendar.", icsData: "" };
        }

        const { error } = await supabase
          .from("bookings")
          .update({
            starts_at: start.toISOString(),
            ends_at: end.toISOString(),
            status: "confirmed",
          })
          .eq("id", booking.id);

        if (error) throw error;

        const ics = generateICSContent(
          booking.id,
          "Cita Reagendada",
          "Tu cita ha sido movida.",
          start.toISOString(),
          end.toISOString()
        );

        return {
          success: true,
          message: "✅ Cita reagendada.",
          bookingId: booking.id,
          icsData: ics,
        };
      } catch (e: any) {
        return { success: false, message: "Error al reagendar: " + e.message, icsData: "" };
      }
    },
  } as any);
}

export function makeGetMyBookingsTool(tenantId: string, customerPhone: string) {
  return tool({
    description: "Busca citas futuras.",
    parameters: z.object({}),
    execute: async () => {
      const { data } = await supabase
        .from("bookings")
        .select("id, starts_at, ends_at, status")
        .eq("tenant_id", tenantId)
        .eq("customer_phone", customerPhone)
        .eq("status", "confirmed")
        .gt("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: true });

      return { found: !!data?.length, bookings: data || [] };
    },
  } as any);
}

export function makeCancelBookingTool(tenantId: string, customerPhone: string) {
  return tool({
    description: "Cancela cita.",
    parameters: z.object({}),
    execute: async () => {
      const { data } = await supabase
        .from("bookings")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("customer_phone", customerPhone)
        .eq("status", "confirmed")
        .order("starts_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!data) return { success: false, message: "No tienes citas activas." };

      await supabase.from("bookings").update({ status: "cancelled" }).eq("id", data.id);
      return { success: true, message: "Cita cancelada." };
    },
  } as any);
}

// ------------------------------------------------------
// 🚫 Compat: exports viejos (para que no reviente imports)
// Si en tu route.ts estabas importando los const antiguos,
// ahora deben apuntar a las factorías.
// ------------------------------------------------------

// ❌ NO uses esto directamente en generateText.
// ✅ Úsalo así:
// checkAvailability: makeCheckAvailabilityTool(tenantId)
// createBooking: makeCreateBookingTool(tenantId, phoneNumber, customerName)
// etc.
export const checkAvailabilityTool = undefined as any;
export const getServicesTool = undefined as any;
export const createBookingTool = undefined as any;
export const rescheduleBookingTool = undefined as any;
export const getMyBookingsTool = undefined as any;
export const cancelBookingTool = undefined as any;
