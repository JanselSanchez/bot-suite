import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

// 1. CONFIGURACIÓN DE SUPABASE
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Faltan las variables de entorno de Supabase (URL o SERVICE_ROLE_KEY)");
}

const supabase = createClient(supabaseUrl, supabaseKey);

// --- DEFINICIÓN DE PARAMETROS (Schemas Zod) ---

// 1. SCHEMA PARA BUSCAR SERVICIOS (NUEVO)
const getServicesSchema = z.object({
  tenantId: z.string().describe("El ID del negocio"),
  query: z.string().optional().describe("Palabra clave para buscar (ej: 'corte', 'barba')"),
});

// 2. SCHEMA AGENDAR (Modificado: serviceId es opcional)
const createBookingSchema = z.object({
  tenantId: z.string().describe("El ID del negocio (tenant)"),
  customerPhone: z.string().describe("El número de WhatsApp del cliente"),
  customerName: z.string().optional().describe("El nombre del cliente (si se conoce)"),
  serviceId: z.string().optional().nullable().describe("El UUID del servicio. SI NO ESTÁS SEGURO, ENVÍA NULL."),
  startTime: z.string().describe("Fecha y hora de inicio en formato ISO (ej: 2025-12-09T14:30:00Z)"),
  durationMinutes: z.number().describe("Duración del servicio en minutos (ej: 30, 60)"),
});

const getMyBookingsSchema = z.object({
  tenantId: z.string(),
  customerPhone: z.string(),
});

const cancelBookingSchema = z.object({
  bookingId: z.string().describe("El UUID de la cita a cancelar"),
});

// --- LÓGICA PURA (Sin dependencias de IA) ---

// 1. HERRAMIENTA DE BÚSQUEDA (La pieza que faltaba)
export const getServicesTool = {
  description: "Busca servicios en el catálogo para obtener su ID y precio. Úsala cuando el cliente pida un servicio por nombre.",
  parameters: getServicesSchema,
  execute: async ({ tenantId, query }: z.infer<typeof getServicesSchema>) => {
    try {
      let queryBuilder = supabase
        .from("items") // Buscamos en la tabla de productos/servicios
        .select("id, name, price_cents, description")
        .eq("tenant_id", tenantId)
        .eq("is_active", true);

      if (query) {
        queryBuilder = queryBuilder.ilike("name", `%${query}%`);
      }

      const { data, error } = await queryBuilder.limit(5);

      if (error) throw error;

      if (!data || data.length === 0) {
        return { found: false, message: "No encontré servicios con ese nombre." };
      }

      // Formateamos para que la IA entienda fácil
      const services = data.map(item => ({
        id: item.id, // <--- AQUÍ ESTÁ EL ID QUE LA IA NECESITA
        name: item.name,
        price: (item.price_cents / 100).toFixed(2)
      }));

      return { found: true, services: services };
    } catch (error) {
      console.error("Error buscando servicios:", error);
      return { found: false, message: "Error técnico buscando servicios." };
    }
  },
};

// 2. HERRAMIENTA AGENDAR (Más robusta)
export const createBookingTool = {
  description: "Registra una nueva cita. Si tienes el serviceId úsalo, si no, envíalo como null.",
  parameters: createBookingSchema,
  execute: async ({ tenantId, customerPhone, customerName, serviceId, startTime, durationMinutes }: z.infer<typeof createBookingSchema>) => {
    // 1. Calcular tiempos
    const start = new Date(startTime);
    const end = new Date(start.getTime() + durationMinutes * 60000);

    // Helper para formatear fecha al estilo iCalendar
    const formatDateICS = (date: Date) => date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    try {
      // 2. Insertar en Supabase
      const { data, error } = await supabase
        .from("bookings")
        .insert({
          tenant_id: tenantId,
          service_id: serviceId || null, // Aceptamos nulos para no bloquear
          customer_phone: customerPhone,
          customer_name: customerName || "Cliente WhatsApp",
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          status: "confirmed",
        })
        .select("id")
        .single();

      if (error) throw error;

      // 3. GENERAR CONTENIDO .ICS
      const icsContent = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//PymeBOT//Agendamiento//ES",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        `UID:${data.id}`,
        `DTSTAMP:${formatDateICS(new Date())}`,
        `DTSTART:${formatDateICS(start)}`,
        `DTEND:${formatDateICS(end)}`,
        "SUMMARY:Cita Confirmada",
        `DESCRIPTION:Reserva para ${customerName || 'Cliente'} en ${tenantId}.`,
        "STATUS:CONFIRMED",
        "END:VEVENT",
        "END:VCALENDAR"
      ].join("\r\n");

      return {
        success: true,
        bookingId: data.id,
        message: `✅ Cita agendada para el ${start.toLocaleString()} correctamente.`,
        icsData: icsContent,
        fileName: 'cita.ics'
      };

    } catch (error) {
      console.error("Error creating booking:", error);
      return { success: false, message: "Hubo un error técnico al guardar la cita." };
    }
  },
};

export const getMyBookingsTool = {
  description: "Busca las citas activas futuras de un cliente usando su teléfono.",
  parameters: getMyBookingsSchema,
  execute: async ({ tenantId, customerPhone }: z.infer<typeof getMyBookingsSchema>) => {
    try {
      const { data: bookings, error } = await supabase
        .from("bookings")
        .select(`
          id, 
          starts_at,
          service_id
        `) // Simplificamos el select para evitar errores de JOIN si la relación falla
        .eq("tenant_id", tenantId)
        .eq("customer_phone", customerPhone)
        .eq("status", "confirmed")
        .gt("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: true });

      if (error) throw error;

      if (!bookings || bookings.length === 0) {
        return { found: false, message: "No encontré citas futuras agendadas con tu número." };
      }

      const formattedBookings = bookings.map((b: any) => ({
        id: b.id,
        date: b.starts_at,
        service: "Servicio Reservado" // Texto genérico para asegurar que funcione
      }));

      return { found: true, bookings: formattedBookings };
    } catch (error) {
      console.error("Error getting bookings:", error);
      return { found: false, message: "Error consultando las citas." };
    }
  },
};

export const cancelBookingTool = {
  description: "Cancela una cita existente dado su ID.",
  parameters: cancelBookingSchema,
  execute: async ({ bookingId }: z.infer<typeof cancelBookingSchema>) => {
    try {
      const { error } = await supabase
        .from("bookings")
        .update({ status: "cancelled" })
        .eq("id", bookingId);

      if (error) throw error;

      return { success: true, message: "La cita ha sido cancelada exitosamente." };
    } catch (error) {
      console.error("Error canceling booking:", error);
      return { success: false, message: "No se pudo cancelar la cita." };
    }
  },
};