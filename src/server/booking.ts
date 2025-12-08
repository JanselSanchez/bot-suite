// src/app/server/booking.ts
//
// Motor de agenda (Booking Engine)
//
// - Busca horarios disponibles para un servicio y fecha.
// - Crea citas validando solapes.
// - Pensado para multi-tenant: siempre requiere tenantId.
// - No importa desde dónde lo llames (API, wa-server, etc.), SIEMPRE pasa por aquí
//   para tocar la tabla de bookings.
//
// Asume tablas (ajusta si tus nombres son otros):
// - services: id, tenant_id, name, duration_minutes
// - business_hours: id, tenant_id, day_of_week (0-6, domingo=0), open_time, close_time (HH:MM)
// - bookings: id, tenant_id, customer_id, service_id, start_at, end_at, status
//

import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Config opcional del BookingEngine.
 */
export interface BookingEngineConfig {
  /**
   * Zona horaria del negocio (para interpretar las fechas).
   * Ajusta según tu realidad. Por defecto RD.
   */
  timeZone?: string;

  /**
   * Estados de booking que se consideran "ocupando" el slot.
   * Ej.: confirmed, pending.
   */
  blockingStatuses?: string[];
}

/**
 * Slot disponible, en hora local.
 */
export interface AvailableSlot {
  /** Fecha completa ISO (ej. 2025-12-08T09:00:00) en zona local del negocio */
  startLocal: string;
  /** Hora legible para mostrar al usuario (ej. "09:00") */
  label: string;
}

/**
 * Resultado al crear cita.
 */
export interface CreateBookingResult {
  ok: boolean;
  error?:
    | "service_not_found"
    | "business_hours_not_found"
    | "slot_not_available"
    | "db_error";
  errorMessage?: string;
  booking?: {
    id: string;
    tenantId: string;
    customerId: string;
    serviceId: string;
    startAt: string;
    endAt: string;
    status: string;
  };
}

/**
 * Motor de agenda.
 *
 * Lo ideal es que lo construyas pasando el SupabaseClient que ya usas
 * (con RLS y tenant aplicado) desde tu API o desde donde lo llames.
 */
export class BookingEngine {
  private readonly timeZone: string;
  private readonly blockingStatuses: string[];

  constructor(
    private readonly supabase: SupabaseClient,
    config?: BookingEngineConfig
  ) {
    this.timeZone = config?.timeZone ?? "America/Santo_Domingo";
    this.blockingStatuses = config?.blockingStatuses ?? ["confirmed", "pending"];
  }

  /**
   * Devuelve los slots disponibles para un servicio en un día concreto.
   *
   * @param tenantId  UUID del negocio
   * @param serviceId UUID del servicio
   * @param date      Fecha en formato "YYYY-MM-DD" en zona local del negocio
   */
  async findAvailableSlots(params: {
    tenantId: string;
    serviceId: string;
    date: string; // "YYYY-MM-DD"
  }): Promise<AvailableSlot[]> {
    const { tenantId, serviceId, date } = params;

    // 1) Leer servicio (duración)
    const { durationMinutes } = await this.getServiceDuration({
      tenantId,
      serviceId,
    });

    if (!durationMinutes) {
      // Sin duración no se puede calcular nada → sin slots.
      return [];
    }

    // 2) Leer horario del negocio para ese día
    const businessHours = await this.getBusinessHoursForDate({
      tenantId,
      date,
    });

    if (!businessHours) {
      // Si no hay horario definido para ese día, no hay atención.
      return [];
    }

    // 3) Generar todos los slots teóricos
    const allSlots = this.generateSlotsForDay({
      date,
      openTime: businessHours.open_time,
      closeTime: businessHours.close_time,
      durationMinutes,
    });

    if (allSlots.length === 0) {
      return [];
    }

    // 4) Leer citas existentes para ese día que bloquean slots
    const existingBookings = await this.getBookingsForDay({
      tenantId,
      serviceId,
      date,
    });

    if (existingBookings.length === 0) {
      // No hay citas → todos los slots teóricos están disponibles
      return allSlots;
    }

    // 5) Filtrar slots que se solapan con alguna cita existente
    const freeSlots = allSlots.filter((slot) => {
      const slotStart = new Date(slot.startLocal);
      const slotEnd = new Date(
        slotStart.getTime() + durationMinutes * 60 * 1000
      );

      const overlaps = existingBookings.some((booking) => {
        const bookingStart = new Date(booking.start_at);
        const bookingEnd = new Date(booking.end_at);
        return this.intervalsOverlap(slotStart, slotEnd, bookingStart, bookingEnd);
      });

      return !overlaps;
    });

    return freeSlots;
  }

  /**
   * Crea una cita si el hueco sigue estando libre.
   *
   * @param tenantId   UUID del negocio
   * @param customerId UUID del cliente
   * @param serviceId  UUID del servicio
   * @param startLocal Fecha/hora local en ISO (ej. 2025-12-08T09:00:00)
   */
  async createBooking(params: {
    tenantId: string;
    customerId: string;
    serviceId: string;
    startLocal: string; // ISO en zona local
  }): Promise<CreateBookingResult> {
    const { tenantId, customerId, serviceId, startLocal } = params;

    // 1) Obtener duración del servicio
    const { durationMinutes } = await this.getServiceDuration({
      tenantId,
      serviceId,
    });

    if (!durationMinutes) {
      return {
        ok: false,
        error: "service_not_found",
        errorMessage:
          "No se encontró el servicio o no tiene duración configurada.",
      };
    }

    const start = new Date(startLocal);
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

    // 2) Validar que no haya solape con otras citas
    const day = startLocal.slice(0, 10); // "YYYY-MM-DD"
    const existingBookings = await this.getBookingsForDay({
      tenantId,
      serviceId,
      date: day,
    });

    const hasOverlap = existingBookings.some((booking) => {
      const bookingStart = new Date(booking.start_at);
      const bookingEnd = new Date(booking.end_at);
      return this.intervalsOverlap(start, end, bookingStart, bookingEnd);
    });

    if (hasOverlap) {
      return {
        ok: false,
        error: "slot_not_available",
        errorMessage: "El horario ya no está disponible.",
      };
    }

    // 3) Insertar booking
    const { data, error } = await this.supabase
      .from("bookings") // TODO: ajusta si tu tabla tiene otro nombre
      .insert({
        tenant_id: tenantId,
        customer_id: customerId,
        service_id: serviceId,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        status: "confirmed", // TODO: ajusta si usas otro default
      })
      .select()
      .single();

    if (error || !data) {
      return {
        ok: false,
        error: "db_error",
        errorMessage: error?.message ?? "Error al crear la cita.",
      };
    }

    return {
      ok: true,
      booking: {
        id: data.id,
        tenantId: data.tenant_id,
        customerId: data.customer_id,
        serviceId: data.service_id,
        startAt: data.start_at,
        endAt: data.end_at,
        status: data.status,
      },
    };
  }

  // =========================
  //   MÉTODOS PRIVADOS
  // =========================

  /**
   * Lee la duración de un servicio (en minutos).
   */
  private async getServiceDuration(params: {
    tenantId: string;
    serviceId: string;
  }): Promise<{ durationMinutes: number | null }> {
    const { tenantId, serviceId } = params;

    const { data, error } = await this.supabase
      .from("services") // TODO: ajusta si tu tabla se llama distinto
      .select("id, tenant_id, duration_minutes")
      .eq("tenant_id", tenantId)
      .eq("id", serviceId)
      .maybeSingle();

    if (error || !data) {
      return { durationMinutes: null };
    }

    // TODO: si tu columna se llama distinto, cambia "duration_minutes"
    const durationMinutes = data.duration_minutes as number | null;

    return { durationMinutes: durationMinutes ?? null };
  }

  /**
   * Lee el horario de trabajo del negocio para un día de calendario.
   * Asume que tienes una tabla business_hours con day_of_week (0-6).
   */
  private async getBusinessHoursForDate(params: {
    tenantId: string;
    date: string; // "YYYY-MM-DD"
  }): Promise<{ open_time: string; close_time: string } | null> {
    const { tenantId, date } = params;

    const dayOfWeek = this.getDayOfWeek(date); // 0-6

    const { data, error } = await this.supabase
      .from("business_hours") // TODO: ajusta si tu tabla se llama distinto
      .select("open_time, close_time, day_of_week")
      .eq("tenant_id", tenantId)
      .eq("day_of_week", dayOfWeek)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    // open_time / close_time esperados como "HH:MM" (ej. "08:00")
    return {
      open_time: data.open_time as string,
      close_time: data.close_time as string,
    };
  }

  /**
   * Devuelve todas las citas relevantes para un día y servicio,
   * filtrando por estados que bloquean.
   */
  private async getBookingsForDay(params: {
    tenantId: string;
    serviceId: string;
    date: string; // "YYYY-MM-DD" en zona local
  }): Promise<{ start_at: string; end_at: string }[]> {
    const { tenantId, serviceId, date } = params;

    // Construimos rango del día [00:00, 23:59:59] en local,
    // pero lo mandamos en ISO. Ajusta si tu DB guarda en UTC.
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(`${date}T23:59:59`);

    const { data, error } = await this.supabase
      .from("bookings") // TODO: ajusta si tu tabla se llama distinto
      .select("start_at, end_at, status, tenant_id, service_id")
      .eq("tenant_id", tenantId)
      .eq("service_id", serviceId)
      .in("status", this.blockingStatuses)
      .gte("start_at", dayStart.toISOString())
      .lte("start_at", dayEnd.toISOString());

    if (error || !data) {
      return [];
    }

    return data.map((row: any) => ({
      start_at: row.start_at as string,
      end_at: row.end_at as string,
    }));
  }

  /**
   * Genera slots teóricos para un día dado el horario de apertura y cierre.
   *
   * @param date        "YYYY-MM-DD"
   * @param openTime    "HH:MM"
   * @param closeTime   "HH:MM"
   * @param durationMin minutos que dura el servicio
   */
  private generateSlotsForDay(params: {
    date: string;
    openTime: string;
    closeTime: string;
    durationMinutes: number;
  }): AvailableSlot[] {
    const { date, openTime, closeTime, durationMinutes } = params;

    const [openHour, openMinute] = openTime.split(":").map(Number);
    const [closeHour, closeMinute] = closeTime.split(":").map(Number);

    const start = new Date(`${date}T00:00:00`);
    start.setHours(openHour, openMinute, 0, 0);

    const end = new Date(`${date}T00:00:00`);
    end.setHours(closeHour, closeMinute, 0, 0);

    const slots: AvailableSlot[] = [];
    let current = new Date(start);

    while (current.getTime() + durationMinutes * 60 * 1000 <= end.getTime()) {
      const label = this.formatTimeLabel(current);
      slots.push({
        startLocal: current.toISOString(),
        label,
      });

      current = new Date(current.getTime() + durationMinutes * 60 * 1000);
    }

    return slots;
  }

  /**
   * Verifica si dos intervalos [aStart, aEnd] y [bStart, bEnd] se solapan.
   */
  private intervalsOverlap(
    aStart: Date,
    aEnd: Date,
    bStart: Date,
    bEnd: Date
  ): boolean {
    return aStart < bEnd && bStart < aEnd;
  }

  /**
   * Devuelve el día de la semana (0-6) para una fecha YYYY-MM-DD.
   * 0 = domingo, 1 = lunes, etc.
   */
  private getDayOfWeek(date: string): number {
    const d = new Date(`${date}T00:00:00`);
    return d.getDay();
  }

  /**
   * Formatea un Date local a "HH:MM" (24h).
   * Ajusta si quieres AM/PM.
   */
  private formatTimeLabel(date: Date): string {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  }
}
