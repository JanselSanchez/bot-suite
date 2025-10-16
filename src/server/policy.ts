import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Verifica si se puede cancelar gratis según ventana (X horas antes).
 * Devuelve { ok, limit, hoursDiff }.
 */
export async function canCancelBooking(
  sb: SupabaseClient,
  tenantId: string,
  bookingId: string
): Promise<{ ok: boolean; limit: number; hoursDiff: number }> {
  // settings
  const { data: settings } = await sb
    .from("tenant_settings")
    .select("cancel_free_hours")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const limit = settings?.cancel_free_hours ?? 3;

  // booking
  const { data: bk } = await sb
    .from("bookings")
    .select("starts_at")
    .eq("id", bookingId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!bk?.starts_at) return { ok: true, limit, hoursDiff: Number.POSITIVE_INFINITY };

  const now = new Date();
  const start = new Date(bk.starts_at);
  const diffMs = start.getTime() - now.getTime();
  const hoursDiff = diffMs / (1000 * 60 * 60);

  const ok = hoursDiff >= limit;
  return { ok, limit, hoursDiff };
}
