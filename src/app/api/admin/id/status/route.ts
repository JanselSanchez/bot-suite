// src/app/api/admin/id/status/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canCancelBooking } from "@/server/policy";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type BookingStatus = "cancelled" | "no_show" | "confirmed" | "unconfirmed";

interface StatusRequestBody {
  id: string;
  status: BookingStatus;
  tenantId: string;
  force?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as StatusRequestBody;
    const { id, status, tenantId, force } = body;

    if (!id || !tenantId || !status) {
      return NextResponse.json(
        { error: "id, tenantId y status son requeridos" },
        { status: 400 }
      );
    }

    // Si es cancelación, valida ventana (a menos que force=true)
    if (status === "cancelled" && !force) {
      const check = await canCancelBooking(sb, tenantId, id);
      if (!check.ok) {
        return NextResponse.json(
          {
            error: "CANCEL_WINDOW_VIOLATION",
            message: `La política impide cancelar con menos de ${check.limit}h. Quedan ${Math.max(
              0,
              check.hoursDiff
            ).toFixed(1)}h.`,
            limit: check.limit,
            hoursDiff: check.hoursDiff,
          },
          { status: 409 }
        );
      }
    }

    const { error } = await sb
      .from("bookings")
      .update({ status })
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : "Error inesperado al actualizar status";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
