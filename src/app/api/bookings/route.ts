// src/app/api/bookings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

/**
 * GET /api/bookings?tenant=<uuid>&status=<str>&service_id=<uuid>&resource_id=<uuid>
 *   &from=<ISO>&to=<ISO>&phone=<str>&page=1&pageSize=20
 *
 * Devuelve: { data: [], page, pageSize, total, hasMore }
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    const tenant     = url.searchParams.get("tenant");       // opcional
    const status     = url.searchParams.get("status");       // confirmed|cancelled|no_show|...
    const serviceId  = url.searchParams.get("service_id");
    const resourceId = url.searchParams.get("resource_id");
    const fromStr    = url.searchParams.get("from");         // ISO
    const toStr      = url.searchParams.get("to");           // ISO
    const phone      = url.searchParams.get("phone");

    const page     = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "20", 10)),
    );
    const offset   = (page - 1) * pageSize;

    // Construimos el query de Supabase
    let query = supabaseAdmin
      .from("bookings")
      .select(
        "id, tenant_id, service_id, resource_id, starts_at, ends_at, status, customer_phone, created_at",
        { count: "exact" },
      );

    if (tenant)     query = query.eq("tenant_id", tenant);
    if (status)     query = query.eq("status", status);
    if (serviceId)  query = query.eq("service_id", serviceId);
    if (resourceId) query = query.eq("resource_id", resourceId);
    if (fromStr)    query = query.gte("starts_at", fromStr);
    if (toStr)      query = query.lt("starts_at", toStr);
    if (phone)      query = query.ilike("customer_phone", `%${phone}%`);

    // orden + paginación
    query = query
      .order("starts_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error("[api/bookings] error:", error);
      return new NextResponse("Error listando bookings", { status: 500 });
    }

    const rows  = data ?? [];
    const total = count ?? 0;

    return NextResponse.json({
      data: rows,
      page,
      pageSize,
      total,
      hasMore: offset + rows.length < total,
    });
  } catch (e: any) {
    console.error("[api/bookings] unhandled:", e);
    return new NextResponse("Error listando bookings: " + e.message, {
      status: 500,
    });
  }
}
