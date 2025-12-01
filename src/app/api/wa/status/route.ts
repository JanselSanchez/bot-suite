// src/app/api/admin/whatsapp/status/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json(
        { ok: false, error: "missing_tenant" },
        { status: 400 }
      );
    }

    const { data: session, error } = await supabaseAdmin
      .from("whatsapp_sessions")
      .select("id, status, qr_data, phone_number, last_connected_at")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) {
      console.error("[wa/status] error:", error);
      return NextResponse.json(
        { ok: false, error: "db_error" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      session: session ?? null,
    });
  } catch (e) {
    console.error("[wa/status] exception:", e);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 }
    );
  }
}
