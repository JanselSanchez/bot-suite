import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

/**
 * GET /api/admin/bookings/list?tenantId=...&page=1&pageSize=20
 *   &q=...&status=confirmed,rescheduled&serviceId=...&resourceId=...
 *   &from=ISO&to=ISO
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get("tenantId");
  if (!tenantId) return NextResponse.json({ error: "tenantId required" }, { status: 400 });

  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)));
  const q = (searchParams.get("q") || "").trim();
  const statusCsv = searchParams.get("status");
  const statusList = statusCsv ? statusCsv.split(",").map(s => s.trim()) : undefined;
  const serviceId = searchParams.get("serviceId");
  const resourceId = searchParams.get("resourceId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let query = supabaseAdmin
    .from("bookings")
    .select("id, tenant_id, service_id, resource_id, customer_phone, customer_name, status, starts_at, ends_at, notes", { count: "exact" })
    .eq("tenant_id", tenantId);

  if (statusList?.length) query = query.in("status", statusList);
  if (serviceId) query = query.eq("service_id", serviceId);
  if (resourceId) query = query.eq("resource_id", resourceId);
  if (from) query = query.gte("starts_at", from);
  if (to) query = query.lte("starts_at", to);
  if (q) {
    // busca por nombre/phone (si tienes columnas indexadas)
    query = query.or(`customer_phone.ilike.%${q}%,customer_name.ilike.%${q}%`);
  }

  query = query.order("starts_at", { ascending: true });

  const fromRow = (page - 1) * pageSize;
  const toRow = fromRow + pageSize - 1;

  const { data, error, count } = await query.range(fromRow, toRow);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({
    data: data ?? [],
    page,
    pageSize,
    total: count ?? 0,
    totalPages: Math.ceil((count ?? 0) / pageSize),
  });
}
