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

function logSbError(tag: string, err: any) {
  // Supabase PostgrestError normalmente trae: message, details, hint, code
  console.error(tag, {
    message: err?.message ?? "",
    code: err?.code ?? "",
    details: err?.details ?? "",
    hint: err?.hint ?? "",
    status: err?.status ?? "",
    name: err?.name ?? "",
  });
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
      return Response.json({ ok: false, error: "ENV_MISSING" } satisfies MetricsResponse, { status: 500 });
    }

    const tenantId = getTenantId(req);
    if (!tenantId) {
      return Response.json({ ok: false, error: "tenantId required" } satisfies MetricsResponse, { status: 400 });
    }

    const sb = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    const isoNow = now.toISOString();
    const isoStart = start.toISOString();

    // ✅ bookingsToday (solo count)
    const bookingsTodayRes = await sb
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("start_at", isoStart)
      .lte("start_at", isoNow);

    if (bookingsTodayRes.error) {
      logSbError("[/api/admin/metrics] bookingsToday error", bookingsTodayRes.error);
      // 🔥 NO devolver el error crudo; devolver strings
      return Response.json(
        {
          ok: false,
          tenantId,
          error: "DB_ERROR_BOOKINGS_TODAY",
          detail: {
            message: bookingsTodayRes.error.message ?? "",
            code: (bookingsTodayRes.error as any).code ?? "",
            details: (bookingsTodayRes.error as any).details ?? "",
            hint: (bookingsTodayRes.error as any).hint ?? "",
          },
        } satisfies MetricsResponse,
        { status: 500 }
      );
    }

    // ✅ upcoming
    const upcomingRes = await sb
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("start_at", isoNow);

    if (upcomingRes.error) {
      logSbError("[/api/admin/metrics] upcoming error", upcomingRes.error);
      return Response.json(
        {
          ok: false,
          tenantId,
          error: "DB_ERROR_UPCOMING",
          detail: {
            message: upcomingRes.error.message ?? "",
            code: (upcomingRes.error as any).code ?? "",
            details: (upcomingRes.error as any).details ?? "",
            hint: (upcomingRes.error as any).hint ?? "",
          },
        } satisfies MetricsResponse,
        { status: 500 }
      );
    }

    return Response.json(
      {
        ok: true,
        tenantId,
        metrics: {
          bookingsToday: bookingsTodayRes.count ?? 0,
          bookingsUpcoming: upcomingRes.count ?? 0,
        },
      } satisfies MetricsResponse,
      { status: 200 }
    );
  } catch (e: any) {
    console.error("[/api/admin/metrics] FATAL", {
      message: e?.message,
      name: e?.name,
      stack: e?.stack,
    });

    return Response.json({ ok: false, error: "internal_error" } satisfies MetricsResponse, { status: 500 });
  }
}
