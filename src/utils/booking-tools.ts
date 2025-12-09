import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

// 1. CONFIGURACIÓN DE SUPABASE
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Faltan las variables de entorno de Supabase (URL o SERVICE_ROLE_KEY)");
}

const supabase = createClient(supabaseUrl, supabaseKey);

// --- SCHEMAS (Validación de datos) ---

const createBookingSchema = z.object({
  tenantId: z.string(),
  customerPhone: z.string(),
  customerName: z.string().optional(),
  serviceId: z.string().optional().nullable(),
  startTime: z.string(),
  durationMinutes: z.number().default(60),
});

const checkAvailabilitySchema = z.object({
  tenantId: z.string(),
  date: z.string().describe("Fecha en formato YYYY-MM-DD"),
});

const getServicesSchema = z.object({
  tenantId: z.string(),
  query: z.string().optional(),
});

const getMyBookingsSchema = z.object({
  tenantId: z.string(),
  customerPhone: z.string(),
});

const cancelBookingSchema = z.object({
  bookingId: z.string(),
});

// --- HERRAMIENTAS (Lógica Pura) ---

// 1. DISPONIBILIDAD (Esta es la que te faltaba)
export const checkAvailabilityTool = {
  description: "Consulta horarios disponibles para una fecha específica.",
  parameters: checkAvailabilitySchema,
  execute: async ({ tenantId, date }: z.infer<typeof checkAvailabilitySchema>) => {
    try {
      const requestedDate = new Date(date);
      const dayOfWeek = requestedDate.getDay(); // 0=Dom, 1=Lun...

      // A) Buscar Horario del Negocio para ese día
      const { data: hours } = await supabase
        .from("business_hours")
        .select("open_time, close_time, is_closed")
        .eq("tenant_id", tenantId)
        .eq("dow", dayOfWeek)
        .maybeSingle();

      if (!hours || hours.is_closed) {
        return { available: false, message: "El negocio está cerrado ese día." };
      }

      // B) Buscar Citas Existentes para restar huecos
      const startOfDay = new Date(date); startOfDay.setHours(0,0,0,0);
      const endOfDay = new Date(date); endOfDay.setHours(23,59,59,999);

      const { data: bookings } = await supabase
        .from("bookings")
        .select("starts_at, ends_at")
        .eq("tenant_id", tenantId)
        .in("status", ["confirmed", "pending"])
        .gte("starts_at", startOfDay.toISOString())
        .lte("ends_at", endOfDay.toISOString());

      // C) Calcular Slots Libres (Simple: cada 30 min)
      const slots = [];
      // Parsear horas "08:00:00"
      const [openH, openM] = hours.open_time.split(':').map(Number);
      const [closeH, closeM] = hours.close_time.split(':').map(Number);
      
      let cursor = new Date(date);
      cursor.setHours(openH, openM, 0, 0);
      
      const closeTime = new Date(date);
      closeTime.setHours(closeH, closeM, 0, 0);

      while (cursor < closeTime) {
        const slotEnd = new Date(cursor.getTime() + 30 * 60000); // Slots de 30 mins
        
        // Verificar si choca con alguna cita
        const isBusy = bookings?.some((b: any) => {
          const bStart = new Date(b.starts_at);
          const bEnd = new Date(b.ends_at);
          // Lógica de colisión
          return (cursor < bEnd && slotEnd > bStart);
        });

        if (!isBusy) {
          slots.push(cursor.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', hour12: true }));
        }
        
        cursor.setMinutes(cursor.getMinutes() + 30); // Siguiente slot
      }

      return { available: true, slots: slots.slice(0, 15) };
    } catch (e) {
      console.error(e);
      return { available: false, message: "Error verificando disponibilidad." };
    }
  }
};

// 2. BUSCAR SERVICIOS
export const getServicesTool = {
  description: "Busca servicios en el catálogo para obtener su ID.",
  parameters: getServicesSchema,
  execute: async ({ tenantId, query }: z.infer<typeof getServicesSchema>) => {
    try {
      let q = supabase.from("items").select("id, name, price_cents").eq("tenant_id", tenantId).eq("is_active", true);
      if (query) q = q.ilike("name", `%${query}%`);
      const { data } = await q.limit(5);
      
      if (!data?.length) return { found: false, message: "No encontré servicios." };
      return { 
        found: true, 
        services: data.map(i => ({ id: i.id, name: i.name, price: i.price_cents/100 })) 
      };
    } catch (e) { return { found: false }; }
  }
};

// 3. AGENDAR (ICS + DB)
export const createBookingTool = {
  description: "Registra una cita.",
  parameters: createBookingSchema,
  execute: async ({ tenantId, customerPhone, customerName, serviceId, startTime, durationMinutes }: z.infer<typeof createBookingSchema>) => {
    const start = new Date(startTime);
    const end = new Date(start.getTime() + durationMinutes * 60000);
    const formatDateICS = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    try {
      const { data, error } = await supabase.from("bookings").insert({
        tenant_id: tenantId,
        service_id: serviceId || null,
        customer_phone: customerPhone,
        customer_name: customerName || "Cliente",
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        status: "confirmed"
      }).select("id").single();

      if (error) throw error;

      const ics = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PymeBOT//ES", "METHOD:PUBLISH", "BEGIN:VEVENT",
        `UID:${data.id}`, `DTSTAMP:${formatDateICS(new Date())}`,
        `DTSTART:${formatDateICS(start)}`, `DTEND:${formatDateICS(end)}`,
        "SUMMARY:Cita Confirmada", `DESCRIPTION:Reserva en ${tenantId}.`, "STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR"
      ].join("\r\n");

      return { success: true, bookingId: data.id, message: "✅ Cita confirmada.", icsData: ics };
    } catch (e) { return { success: false, message: "Error al guardar." }; }
  }
};

// 4. MIS CITAS & CANCELAR
export const getMyBookingsTool = {
  description: "Busca citas futuras.",
  parameters: getMyBookingsSchema,
  execute: async ({ tenantId, customerPhone }: any) => {
    const { data } = await supabase.from("bookings").select("id, starts_at").eq("tenant_id", tenantId).eq("customer_phone", customerPhone).eq("status", "confirmed").gt("starts_at", new Date().toISOString());
    return { found: !!data?.length, bookings: data };
  }
};

export const cancelBookingTool = {
  description: "Cancela cita.",
  parameters: cancelBookingSchema,
  execute: async ({ bookingId }: any) => {
    await supabase.from("bookings").update({ status: "cancelled" }).eq("id", bookingId);
    return { success: true };
  }
};