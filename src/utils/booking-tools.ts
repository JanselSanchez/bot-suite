/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { tool } from "ai";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) throw new Error("Faltan credenciales Supabase");
const supabase = createClient(supabaseUrl, supabaseKey);

// --- HELPER: GENERADOR DE ICS ---
function generateICSContent(id: string, title: string, description: string, startISO: string, endISO: string) {
  const formatDateICS = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
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
    "END:VCALENDAR"
  ].join("\r\n");
}

// --- TOOLS ---

// 1. DISPONIBILIDAD
export const checkAvailabilityTool = tool({
  description: "Consulta horarios disponibles.",
  parameters: z.object({
    tenantId: z.string(),
    requestedDate: z.string().describe("Fecha YYYY-MM-DD"),
  }),
  execute: async (input: any) => {
    const { tenantId, requestedDate } = input;
    try {
      const date = new Date(requestedDate);
      const dayOfWeek = date.getDay(); 

      const { data: hours } = await supabase.from("business_hours").select("open_time, close_time, is_closed").eq("tenant_id", tenantId).eq("dow", dayOfWeek).maybeSingle();
      
      if (!hours || hours.is_closed) return { available: false, message: "Cerrado ese día." };

      const startOfDay = new Date(requestedDate); startOfDay.setHours(0,0,0,0);
      const endOfDay = new Date(requestedDate); endOfDay.setHours(23,59,59,999);

      const { data: bookings } = await supabase.from("bookings")
        .select("starts_at, ends_at")
        .eq("tenant_id", tenantId)
        .in("status", ["confirmed", "pending"])
        .gte("starts_at", startOfDay.toISOString())
        .lte("ends_at", endOfDay.toISOString());

      const slots: any[] = [];
      const [openH, openM] = hours.open_time.split(':').map(Number);
      const [closeH, closeM] = hours.close_time.split(':').map(Number);
      
      let cursor = new Date(requestedDate); cursor.setHours(openH, openM, 0, 0);
      const closeTime = new Date(requestedDate); closeTime.setHours(closeH, closeM, 0, 0);

      while (cursor < closeTime) {
        const slotEnd = new Date(cursor.getTime() + 60 * 60000);
        
        const isBusy = bookings?.some((b: any) => {
          const bStart = new Date(b.starts_at);
          const bEnd = new Date(b.ends_at);
          return (cursor < bEnd && slotEnd > bStart);
        });

        if (!isBusy) {
            slots.push({
                label: cursor.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', hour12: true }),
                iso: cursor.toISOString()
            });
        }
        cursor.setMinutes(cursor.getMinutes() + 30);
      }
      return { available: true, slots: slots.slice(0, 15) };
    } catch (e) { return { available: false, message: "Error verificando." }; }
  },
} as any); // 👈 EL FIX: Casting a 'any' para silenciar el error de overload

// 2. BUSCAR SERVICIOS
export const getServicesTool = tool({
  description: "Busca servicios y precios.",
  parameters: z.object({
    tenantId: z.string(),
  }),
  execute: async (input: any) => {
    const { tenantId } = input;
    try {
      const { data } = await supabase.from("items").select("id, name, price_cents").eq("tenant_id", tenantId).eq("is_active", true).limit(5);
      
      const services = data?.map((i: any) => ({ 
        name: i.name, 
        price: i.price_cents / 100 
      })) || [];

      return { services };
    } catch (e) { return { services: [] }; }
  },
} as any);

// 3. AGENDAR (CON ICS)
export const createBookingTool = tool({
  description: "Crea una nueva cita.",
  parameters: z.object({
    tenantId: z.string(),
    customerPhone: z.string(),
    customerName: z.string().optional(),
    serviceId: z.string().optional().nullable(),
    startsAtISO: z.string().describe("Fecha inicio ISO 8601"),
    endsAtISO: z.string().optional(),
    notes: z.string().optional(),
  }),
  execute: async (input: any) => {
    const { tenantId, customerPhone, customerName, serviceId, startsAtISO, endsAtISO, notes } = input;
    
    const start = new Date(startsAtISO);
    // Si no viene fin, asumimos 1 hora
    const end = endsAtISO ? new Date(endsAtISO) : new Date(start.getTime() + 60 * 60000);
    
    try {
      const { data, error } = await supabase.from("bookings").insert({
        tenant_id: tenantId,
        service_id: serviceId || null,
        customer_phone: customerPhone,
        customer_name: customerName || "Cliente Web",
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        status: "confirmed",
        notes: notes || "Agendado por IA"
      }).select("id").single();

      if (error) throw error;

      // 🔥 GENERAR ICS
      const ics = generateICSContent(data.id, "Cita Confirmada", `Reserva en ${tenantId}`, start.toISOString(), end.toISOString());

      return { success: true, message: "✅ Cita confirmada.", icsData: ics };
    } catch (e: any) { 
        return { success: false, message: "Error al guardar: " + e.message, icsData: "" }; 
    }
  },
} as any);

// 4. REAGENDAR (CON ICS)
export const rescheduleBookingTool = tool({
  description: "Reagenda una cita existente.",
  parameters: z.object({
    tenantId: z.string(),
    customerPhone: z.string(),
    newStartsAtISO: z.string().describe("Nueva fecha inicio ISO 8601"),
  }),
  execute: async (input: any) => {
    const { tenantId, customerPhone, newStartsAtISO } = input;

    const start = new Date(newStartsAtISO);
    const end = new Date(start.getTime() + 60 * 60000);

    try {
      // 1. Buscar la cita activa más reciente
      const { data: booking } = await supabase.from("bookings")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("customer_phone", customerPhone)
        .in("status", ["confirmed", "pending"])
        .order("starts_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!booking) return { success: false, message: "No encontré cita para reagendar.", icsData: "" };

      // 2. Actualizar
      const { error } = await supabase.from("bookings").update({
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        status: "confirmed"
      }).eq("id", booking.id);

      if (error) throw error;

      // 🔥 GENERAR ICS
      const ics = generateICSContent(booking.id, "Cita Reagendada", "Tu cita ha sido movida.", start.toISOString(), end.toISOString());

      return { success: true, message: "✅ Cita reagendada.", icsData: ics };
    } catch (e: any) { 
        return { success: false, message: "Error al reagendar: " + e.message, icsData: "" }; 
    }
  },
} as any);

// 5. MIS CITAS
export const getMyBookingsTool = tool({
  description: "Busca citas futuras.",
  parameters: z.object({
    tenantId: z.string(),
    customerPhone: z.string(),
  }),
  execute: async (input: any) => {
    const { tenantId, customerPhone } = input;

    const { data } = await supabase.from("bookings")
      .select("starts_at")
      .eq("tenant_id", tenantId)
      .eq("customer_phone", customerPhone)
      .eq("status", "confirmed")
      .gt("starts_at", new Date().toISOString());
    
    return { found: !!data?.length, bookings: data };
  },
} as any);

// 6. CANCELAR
export const cancelBookingTool = tool({
  description: "Cancela cita.",
  parameters: z.object({
    tenantId: z.string(),
    customerPhone: z.string(),
  }),
  execute: async (input: any) => {
    const { tenantId, customerPhone } = input;
    
    // Buscar la última
    const { data } = await supabase.from("bookings")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("customer_phone", customerPhone)
        .eq("status", "confirmed")
        .order("starts_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if(!data) return { success: false, message: "No tienes citas activas." };

    await supabase.from("bookings").update({ status: "cancelled" }).eq("id", data.id);
    return { success: true, message: "Cita cancelada." };
  },
} as any);