import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MetricsResponse = {
  ok: boolean;
  tenantId?: string;
  metrics?: {
    bookingsToday: number;
    bookingsUpcoming: number;
    messages24h: number;
    customersTotal: number;
  };
  error?: string;
  detail?: any;
};

function pickTenantId(req: Request, cookieStore: Awaited<ReturnType<typeof cookies>>) {
  const url = new URL(req.url);

  // 1) query ?tenantId=
  const q = url.searchParams.get("tenantId");
  if (q && q.trim()) return q.trim();

  // 2) header x-tenant-id
  const h = req.headers.get("x-tenant-id");
  if (h && h.trim()) return h.trim();

  // 3) cookie activa
  const c = cookieStore.get("pyme.active_tenant")?.value;
  if (c && c.trim()) return c.trim();

  return "";
}

export async function GET(req: Request) {
  // ⚠️ IMPORTANTE: NO LEER body aquí. Nada de req.json()/req.text() en metrics.
  const cookieStore = await cookies();

  try {
    const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("[/api/admin/metrics] ENV_MISSING", {
        hasUrl: !!supabaseUrl,
        hasService: !!serviceRoleKey,
      });

      return NextResponse.json(
        { ok: false, error: "Error servidor (env)" } satisfies MetricsResponse,
        { status: 500 }
      );
    }

    const tenantId = pickTenantId(req, cookieStore);

    if (!tenantId) {
      return NextResponse.json(
        { ok: false, error: "tenantId required" } satisfies MetricsResponse,
        { status: 400 }
      );
    }

    const sb = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Fechas para métricas simples
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const isoNow = now.toISOString();
    const isoStartToday = startOfToday.toISOString();

    const dayAgo = new Date(now);
    dayAgo.setHours(now.getHours() - 24);
    const isoDayAgo = dayAgo.toISOString();

    // 1) Bookings de hoy
    const bookingsTodayRes = await sb
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("start_at", isoStartToday)
      .lte("start_at", isoNow);

    if (bookingsTodayRes.error) {
      console.error("[/api/admin/metrics] bookingsToday error", bookingsTodayRes.error);
      return NextResponse.json(
        { ok: false, tenantId, error: "db_error", detail: bookingsTodayRes.error } satisfies MetricsResponse,
        { status: 500 }
      );
    }

    // 2) Bookings próximos (desde ahora)
    const upcomingRes = await sb
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("start_at", isoNow);

    if (upcomingRes.error) {
      console.error("[/api/admin/metrics] upcoming error", upcomingRes.error);
      return NextResponse.json(
        { ok: false, tenantId, error: "db_error", detail: upcomingRes.error } satisfies MetricsResponse,
        { status: 500 }
      );
    }

    // 3) Mensajes últimas 24h (ajusta el nombre de tabla/columna si difiere)
    // Si tu tabla se llama diferente, cámbiala aquí: messages / conversation_messages / inbound_messages, etc.
    const messages24hRes = await sb
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("created_at", isoDayAgo);

    // Nota: si "messages" no existe, esto te lo dirá con error real y ya sabremos el nombre correcto.
    if (messages24hRes.error) {
      console.error("[/api/admin/metrics] messages24h error", messages24hRes.error);
      // No tumbemos todo: devolvemos 0 pero dejamos el error logueado para corregir tabla real.
    }

    // 4) Clientes totales (ajusta a tu tabla real: customers/clients/leads)
    const customersTotalRes = await sb
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);

    if (customersTotalRes.error) {
      console.error("[/api/admin/metrics] customersTotal error", customersTotalRes.error);
      // Igual que arriba: no tumbar todo si la tabla se llama distinto.
    }

    const data: MetricsResponse = {
      ok: true,
      tenantId,
      metrics: {
        bookingsToday: bookingsTodayRes.count ?? 0,
        bookingsUpcoming: upcomingRes.count ?? 0,
        messages24h: messages24hRes.count ?? 0,
        customersTotal: customersTotalRes.count ?? 0,
      },
    };

    return NextResponse.json(data, { status: 200 });
  } catch (e: any) {
    console.error("[/api/admin/metrics] FATAL", {
      message: e?.message,
      stack: e?.stack,
    });

    return NextResponse.json(
      { ok: false, error: "internal_error", detail: String(e?.message || e) } satisfies MetricsResponse,
      { status: 500 }
    );
  }
}
