// src/app/api/admin/id/reschedule/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

type ReschedulePayload = {
  tenantId?: string;
  bookingId?: string;
  newStartISO?: string;
  newEndISO?: string | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ReschedulePayload;

    const { tenantId, bookingId, newStartISO, newEndISO } = body ?? {};

    if (!tenantId || !bookingId || !newStartISO) {
      return NextResponse.json(
        {
          ok: false,
          error: "missing_fields",
          detail: "tenantId, bookingId y newStartISO son requeridos",
        },
        { status: 400 }
      );
    }

    const updates: { starts_at: string; ends_at?: string | null } = {
      starts_at: newStartISO,
    };
    if (newEndISO) {
      updates.ends_at = newEndISO;
    }

    const { data, error } = await supabaseAdmin
      .from("bookings")
      .update(updates)
      .eq("id", bookingId)
      .eq("tenant_id", tenantId)
      .select("id, tenant_id, starts_at, ends_at, status")
      .maybeSingle();

    if (error) {
      console.error("[api/admin/id/reschedule] supabase error:", error);
      return NextResponse.json(
        { ok: false, error: "db_error", detail: error.message },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { ok: false, error: "not_found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      data,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/admin/id/reschedule] unhandled:", msg);
    return NextResponse.json(
      { ok: false, error: "unhandled", detail: msg },
      { status: 500 }
    );
  }
}

// Opcional, pero válido para el tipo RouteHandlerConfig
export const dynamic = "force-dynamic";
