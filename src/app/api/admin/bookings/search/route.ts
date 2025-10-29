// src/app/api/admin/bookings/search/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnyBooking = {
  id: string;
  tenant_id: string;
  service_id?: string | null;
  resource_id?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  phone_norm?: string | null;
  starts_at: string;
  created_at?: string | null;
  // campos opcionales según tu esquema
  status?: string | null;
  booking_status?: string | null;
  is_active?: boolean | null;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenantId")?.trim();
  const q        = (url.searchParams.get("q") || "").trim();
  const date     = (url.searchParams.get("date") || "").trim(); // YYYY-MM-DD
  const scope    = (url.searchParams.get("scope") || "upcoming") as
    | "all"
    | "today"
    | "upcoming"
    | "past";
  const page     = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(parseInt(url.searchParams.get("pageSize") || "20", 10), 50);

  if (!tenantId) {
    return NextResponse.json({ ok:false, error:"tenantId required" }, { status:400 });
  }

  // Servidor: usar SERVICE_ROLE para evitar intermitencias por RLS/sesión
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // Base query sobre bookings (tu tabla real)
  let qbk = sb
    .from("bookings")
    .select("*", { count: "exact" })
    .eq("tenant_id", tenantId);

  // Búsqueda por nombre/teléfono
  if (q) {
    const safe = q.replace(/,/g, " ");
    qbk = qbk.or(
      [
        `customer_name.ilike.%${safe}%`,
        `customer_phone.ilike.%${safe}%`,
        `phone_norm.ilike.%${safe}%`,
      ].join(",")
    );
  }

  // ===== Filtro por fecha (RD -4) =====
  const RD_OFFSET_MIN = 240;
  const toUTCStartOfDay = (yyyy_mm_dd: string) => {
    const [y, m, d] = yyyy_mm_dd.split("-").map(Number);
    const localMidnightUTC = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
    return new Date(localMidnightUTC + RD_OFFSET_MIN * 60 * 1000).toISOString();
  };

  const nowUTC = new Date();
  const nowLocalRD = new Date(nowUTC.getTime() - RD_OFFSET_MIN * 60 * 1000);
  const todayLocalStr = nowLocalRD.toISOString().slice(0, 10);

  if (date) {
    const startUTC = toUTCStartOfDay(date);
    const endUTC = toUTCStartOfDay(
      new Date(new Date(date).getTime() + 86_400_000).toISOString().slice(0, 10)
    );
    qbk = qbk.gte("starts_at", startUTC).lt("starts_at", endUTC);
  } else if (scope === "today") {
    const startUTC = toUTCStartOfDay(todayLocalStr);
    const endUTC = toUTCStartOfDay(
      new Date(new Date(todayLocalStr).getTime() + 86_400_000).toISOString().slice(0, 10)
    );
    qbk = qbk.gte("starts_at", startUTC).lt("starts_at", endUTC);
  } else if (scope === "upcoming") {
    qbk = qbk.gte("starts_at", nowUTC.toISOString());
  } else if (scope === "past") {
    qbk = qbk.lt("starts_at", nowUTC.toISOString());
  }
  // scope === "all" => no se aplica filtro de fecha

  // Orden + paginación
  qbk = qbk
    .order("starts_at", { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);

  const { data, error, count } = (await qbk) as unknown as {
    data: AnyBooking[] | null;
    error: any;
    count: number | null;
  };

  if (error) {
    console.error("[/api/admin/bookings/search] ERROR:", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
    return NextResponse.json(
      { ok:false, error: error.message, code: error.code, details: error.details, hint: error.hint },
      { status: 500, headers: { "cache-control": "no-store" } }
    );
  }

  // Adaptar a lo que consume la UI
  const adapted = (data ?? []).map((b) => ({
    id: b.id,
    tenant_id: b.tenant_id,
    service_id: b.service_id ?? null,
    resource_id: b.resource_id ?? null,
    customer_name: b.customer_name ?? null,
    customer_phone: b.phone_norm ?? b.customer_phone ?? null,
    staff_name: null, // mapearás cuando tengas staff real
    starts_at: b.starts_at,
    status: b.status ?? b.booking_status ?? (b.is_active === false ? "cancelled" : "confirmed"),
    created_at: b.created_at ?? null,
  }));

  return NextResponse.json(
    { ok: true, data: adapted, page, pageSize, total: count ?? 0 },
    { headers: { "cache-control": "no-store" } }
  );
}
