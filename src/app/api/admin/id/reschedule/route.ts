import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  const body = await req.json();
  const { tenantId, starts_at, ends_at } = body as {
    tenantId: string;
    starts_at: string;
    ends_at: string;
  };

  if (!tenantId || !starts_at || !ends_at) {
    return NextResponse.json({ error: "tenantId/starts_at/ends_at requeridos" }, { status: 400 });
  }

  const { error } = await sb
    .from("bookings")
    .update({ starts_at, ends_at, status: "confirmed" })
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
