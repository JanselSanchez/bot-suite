import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MetricsResponse = {
  ok: boolean;
  tenantId?: string;
  metrics?: {
    bookingsToday: number;
    bookingsUpcoming: number;
  };
  // ✅ Añadimos los tipos que el Dashboard (UI) está esperando
  totals?: {
    bookings: number;
    tenants: number;
    messages: number;
  };
  recent?: any[];
  error?: string;
  detail?: any;
};

function getTenantId(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("tenantId")?.trim();
  if (q) return q;

  const h = req.headers.get("x-tenant-id")?.trim();
  if (h) return h;

  return "";
}

function normalizeAnyError(err: any) {
  // Soporta PostgrestError y errores tipo TypeError (fetch failed, etc.)
  const isObject = err && typeof err === "object";
  return {
    message: isObject ? (err.message ?? String(err)) : String(err ?? ""),
    code: isObject ? (err.code ?? "") : "",
    details: isObject ? (err.details ?? "") : "",
    hint: isObject ? (err.hint ?? "") : "",
    status: isObject ? (err.status ?? "") : "",
    name: isObject ? (err.name ?? "") : "",
    stack: isObject ? (err.stack ?? "") : "",
  };
}

function logSbError(tag: string, err: any) {
  console.error(tag, normalizeAnyError(err));
}

export async function GET(req: Request) {
  // 🔒 Nunca leer body aquí: nada de req.json()/req.text()
  try {
    const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("[/api/admin/metrics] ENV_MISSING", {
        hasUrl: !!supabaseUrl,
        hasService: !!serviceRoleKey,
      });
      return Response.json(
        { ok: false, error: "ENV_MISSING" } satisfies MetricsResponse,
        { status: 500 }
      );
    }

    const tenantId = getTenantId(req);
    if (!tenantId) {
      return Response.json(
        { ok: false, error: "tenantId required" } satisfies MetricsResponse,
        { status: 400 }
      );
    }

    const sb = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const now = new Date();

    // "hoy" en UTC (coherente con timestamps ISO)
    const startOfToday = new Date(now);
    startOfToday.setUTCHours(0, 0, 0, 0);

    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setUTCDate(startOfTomorrow.getUTCDate() + 1);

    const isoNow = now.toISOString();
    const isoStartToday = startOfToday.toISOString();
    const isoStartTomorrow = startOfTomorrow.toISOString();

    // ✅ FIX: columna correcta es starts_at (no start_at)
    const bookingsTodayRes = await sb
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("starts_at", isoStartToday)
      .lt("starts_at", isoStartTomorrow);

    if (bookingsTodayRes.error) {
      logSbError("[/api/admin/metrics] bookingsToday error", bookingsTodayRes.error);
      const e = normalizeAnyError(bookingsTodayRes.error);
      return Response.json(
        {
          ok: false,
          tenantId,
          error: "DB_ERROR_BOOKINGS_TODAY",
          detail: e,
        } satisfies MetricsResponse,
        { status: 500 }
      );
    }

    const upcomingRes = await sb
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("starts_at", isoNow);

    if (upcomingRes.error) {
      logSbError("[/api/admin/metrics] upcoming error", upcomingRes.error);
      const e = normalizeAnyError(upcomingRes.error);
      return Response.json(
        {
          ok: false,
          tenantId,
          error: "DB_ERROR_UPCOMING",
          detail: e,
        } satisfies MetricsResponse,
        { status: 500 }
      );
    }

    // ==========================================
    // ✅ NUEVAS CONSULTAS PARA ALIMENTAR EL UI
    // ==========================================
    
    // 1. Total histórico de citas
    const totalBookingsRes = await sb
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);

    // 2. Total de clientes (tenants)
    const totalCustomersRes = await sb
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);

    // 3. Últimas 5 citas (Actividad Reciente)
    const recentRes = await sb
      .from("bookings")
      .select("id, customer_name, created_at, starts_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(5);

    // Formateamos las citas recientes para que el UI las lea fácil
    const recentFormatted = (recentRes.data || []).map((b: any) => ({
      id: String(b.id),
      title: b.customer_name ? `Cita: ${b.customer_name}` : "Cita agendada",
      created_at: b.created_at || b.starts_at,
    }));

    return Response.json(
      {
        ok: true,
        tenantId,
        metrics: {
          bookingsToday: bookingsTodayRes.count ?? 0,
          bookingsUpcoming: upcomingRes.count ?? 0,
        },
        // ✅ Pasamos las variables exactas que tu UI está pidiendo
        totals: {
          bookings: totalBookingsRes.count ?? 0,
          tenants: totalCustomersRes.count ?? 0,
          messages: 0, // Si tienes tabla de mensajes en un futuro, va aquí
        },
        recent: recentFormatted,
      } satisfies MetricsResponse,
      { status: 200 }
    );
  } catch (e: any) {
    const info = normalizeAnyError(e);
    console.error("[/api/admin/metrics] FATAL", info);

    return Response.json(
      { ok: false, error: "internal_error", detail: info } satisfies MetricsResponse,
      { status: 500 }
    );
  }
}