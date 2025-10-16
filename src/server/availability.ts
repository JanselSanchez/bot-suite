// server/availability.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { startOfDay, addMinutes } from "date-fns";

type Slot = {
  resource_id: string;
  resource_name: string;
  start: Date;
  end: Date;
};

/**
 * La fecha `date` debe llegar como "00:00 local RD" expresada en UTC.
 * Reglas (business_hours) son locales y se proyectan a UTC para comparar con bookings guardados en UTC.
 */
export async function getAvailableSlots(params: {
  supabase: SupabaseClient;
  tenantId: string;
  serviceId: string;
  date: Date; // 00:00 local RD en UTC
  tz?: string;
  maxSlots?: number;
}): Promise<Slot[]> {
  const { supabase, tenantId, serviceId, date, maxSlots = 8 } = params;

  // RD offset fijo: UTC-4
  const RD_OFFSET_MIN = 240;

  // Límites del día local en UTC
  const dayStartUTC = startOfDay(date); // `date` ya es medianoche local proyectada a UTC
  const dayEndUTC = addMinutes(dayStartUTC, 24 * 60);

  // === Weekday local (RD) ===
  // restamos el offset y usamos getUTCDay() para evitar que Node use zona del servidor
  const localWeekday = new Date(dayStartUTC.getTime() - RD_OFFSET_MIN * 60 * 1000).getUTCDay();
  // 0=domingo, 1=lunes, ..., 6=sábado

  // 1) Servicio
  const { data: service, error: svcErr } = await supabase
    .from("services")
    .select("id, name, duration_min, buffer_after_min")
    .eq("id", serviceId)
    .maybeSingle();
  if (svcErr) console.error("[availability][services] error:", svcErr);
  if (!service) return [];

  const durationMin = service.duration_min ?? 30;
  const step = durationMin + (service.buffer_after_min ?? 0);

  // 2) Recursos del servicio
  const { data: res, error: resErr } = await supabase
    .from("service_resources")
    .select("resource_id, resources(name)")
    .eq("service_id", serviceId);
  if (resErr) console.error("[availability][service_resources] error:", resErr);

  const resources = (res ?? []).map((r: any) => ({
    id: r.resource_id as string,
    name: (r.resources?.name as string) ?? "Recurso",
  }));
  if (!resources.length) return [];

  // 3) Horario laboral local del día
  const { data: hours, error: hrsErr } = await supabase
    .from("business_hours")
    .select("weekday, open_time, close_time, is_closed")
    .eq("tenant_id", tenantId)
    .eq("weekday", localWeekday)
    .maybeSingle();
  if (hrsErr) console.error("[availability][business_hours] error:", hrsErr);

  if (!hours) {
    console.warn(`[availability] No hay registro de horario para weekday=${localWeekday}`);
    return [];
  }

  if ((hours as any).is_closed) {
    console.log(`[availability] Día ${localWeekday} está marcado como cerrado`);
    return [];
  }

  if (!hours.open_time || !hours.close_time) return [];

  const [oH, oM] = String(hours.open_time).split(":").map(Number);
  const [cH, cM] = String(hours.close_time).split(":").map(Number);

  // Proyectar 09:00/18:00 locales a UTC — ¡sin volver a sumar offset! (ya está incorporado en dayStartUTC)
  const openUTC = addMinutes(dayStartUTC, oH * 60 + oM);
  const closeUTC = addMinutes(dayStartUTC, cH * 60 + cM);
  if (closeUTC <= openUTC) return [];

  // 4) Bookings del día — SOLO los que BLOQUEAN: confirmed
  const { data: bookings, error: bErr } = await supabase
    .from("bookings")
    .select("resource_id, starts_at, ends_at, status")
    .gte("starts_at", dayStartUTC.toISOString())
    .lt("starts_at", dayEndUTC.toISOString())
    .eq("status", "confirmed"); // ⬅️ clave: no incluir rescheduled
  if (bErr) console.error("[availability][bookings] error:", bErr);

  // Indexar bookings por recurso
  const bookingsByRes = new Map<string, Array<{ s: Date; e: Date }>>();
  for (const r of resources) bookingsByRes.set(r.id, []);
  for (const b of bookings ?? []) {
    const arr = bookingsByRes.get(b.resource_id) || [];
    arr.push({ s: new Date(b.starts_at), e: new Date(b.ends_at) });
    bookingsByRes.set(b.resource_id, arr);
  }

  // 5) Generar slots (en UTC), jornada completa
  const out: Slot[] = [];
  for (const r of resources) {
    let cursor = new Date(openUTC);
    let count = 0;

    while (addMinutes(cursor, step) <= closeUTC) {
      const slotStart = new Date(cursor);
      const slotEnd = addMinutes(slotStart, durationMin);

      const overlap = (bookingsByRes.get(r.id) || []).some((b) => {
        return !(slotEnd <= b.s || slotStart >= b.e);
      });

      if (!overlap) {
        out.push({
          resource_id: r.id,
          resource_name: r.name,
          start: slotStart,
          end: slotEnd,
        });
        count++;
        if (count >= maxSlots) break; // ⬅️ limitar por recurso
      }

      cursor = addMinutes(cursor, step);
    }
  }

  if (process.env.BOT_DEBUG === "true") {
    console.log(
      `[availability] ${out.length} slots generados para weekday=${localWeekday}`,
      out.map((s) => s.start.toISOString())
    );
  }

  return out;
}
