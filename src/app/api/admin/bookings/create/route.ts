import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

/**
 * POST body:
 * { tenantId, phone, customerName, serviceId, resourceId, startsAtISO, endsAtISO, notes? }
 */
export async function POST(req: Request) {
  const body = await req.json();
  const { tenantId, phone, customerName, serviceId, resourceId, startsAtISO, endsAtISO, notes } = body || {};
  if (!tenantId || !phone || !serviceId || !resourceId || !startsAtISO || !endsAtISO) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc("book_slot_safe_phone", {
    p_tenant: tenantId,
    p_phone: phone,
    p_service: serviceId,
    p_resource: resourceId,
    p_starts: startsAtISO,
    p_ends: endsAtISO,
    p_customer_name: customerName || "Cliente",
    p_notes: notes || null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
