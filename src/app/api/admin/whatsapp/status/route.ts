// src/app/api/admin/whatsapp/status/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: "missing_sessionId" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("whatsapp_sessions")
      .select(
        "id, status, qr_data, qr_svg, phone_number, last_connected_at, last_seen_at, last_error"
      )
      .eq("id", sessionId)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json(
        { ok: false, error: "session_not_found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      session: {
        id: data.id,
        status: data.status,
        qr_data: data.qr_data,
        qr_svg: data.qr_svg,
        phone_number: data.phone_number,
        last_connected_at: data.last_connected_at,
        last_seen_at: data.last_seen_at,
        last_error: data.last_error,
      },
    });
  } catch (err) {
    console.error("[admin/whatsapp/status] error:", err);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 }
    );
  }
}
