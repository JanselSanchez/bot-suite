import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // server only
);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get("tenantId");
  const scope = (searchParams.get("scope") || "today") as
    | "today"
    | "upcoming"
    | "past";

  if (!tenantId) {
    return NextResponse.json({ error: "tenantId requerido" }, { status: 400 });
  }

  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const todayEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));

  let q = sb
    .from("bookings")
    .select("id, tenant_id, service_id, resource_id, customer_name, customer_phone, staff_name, starts_at, ends_at, status")
    .eq("tenant_id", tenantId)
    .order("starts_at", { ascending: true });

  if (scope === "today") {
    q = q.gte("starts_at", todayStart.toISOString()).lte("starts_at", todayEnd.toISOString());
  } else if (scope === "upcoming") {
    q = q.gt("starts_at", todayEnd.toISOString());
  } else if (scope === "past") {
    q = q.lt("starts_at", todayStart.toISOString());
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
