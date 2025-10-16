import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

/** POST { tenantId, bookingId } */
export async function POST(req: Request) {
  const { tenantId, bookingId } = await req.json();
  if (!tenantId || !bookingId) return NextResponse.json({ error: "missing fields" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("bookings")
    .update({ status: "no_show", updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", bookingId)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id: data?.id });
}
