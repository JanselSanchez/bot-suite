import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAvailableSlots } from "@/server/availability";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get("tenantId");
  const serviceId = searchParams.get("serviceId");
  const date = searchParams.get("date"); // YYYY-MM-DD

  if (!tenantId || !serviceId || !date) {
    return NextResponse.json({ error: "tenantId, serviceId y date requeridos" }, { status: 400 });
  }

  const [y, m, d] = date.split("-").map(Number);
  // 00:00 local RD = 04:00 UTC  (offset -4h)
  const RD_OFFSET_MIN = 240;
  const day = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0) + RD_OFFSET_MIN * 60 * 1000);
  // `day` ahora representa "medianoche local" expresada en UTC
  

  try {
    const slots = await getAvailableSlots({
      supabase: sb,
      tenantId,
      serviceId,
      date: day,
      maxSlots: 24,
    });

    return NextResponse.json({
      data: slots.map((s) => ({
        resource_id: s.resource_id,
        resource_name: s.resource_name,
        start: s.start.toISOString(),
        end: s.end.toISOString(),
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "availability error" }, { status: 500 });
  }
}
