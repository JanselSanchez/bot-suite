// src/app/api/admin/metrics/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenantId")?.trim();
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: "tenantId required" }, { status: 400 });
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, // SERVICE ROLE (server)
    { auth: { persistSession: false } }
  );

  // Totales
  const { count: totalBookings, error: eBk } = await sb
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  const { count: totalTenants, error: eTen } = await sb
    .from("tenants")
    .select("id", { count: "exact", head: true });

  const { count: totalMessages, error: eMsg } = await sb
    .from("messages")
    .select("id", { count: "exact", head: true });

  // Recientes (últimas 5 del tenant)
  const { data: recentBookings, error: eRecent } = await sb
    .from("bookings")
    .select("id, customer_name, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (eBk || eTen || eMsg || eRecent) {
    console.error("[/api/admin/metrics] ERR", { eBk, eTen, eMsg, eRecent, tenantId });
  }

  const recent = (recentBookings ?? []).map((b) => ({
    id: b.id,
    title: `Nueva cita ${b.customer_name ? `de ${b.customer_name}` : `#${String(b.id).slice(0, 6)}`}`,
    created_at: b.created_at as string,
  }));

  return NextResponse.json(
    {
      ok: true,
      totals: {
        bookings: totalBookings ?? 0, // bookings del tenant actual
        tenants: totalTenants ?? 0,   // total de tenants (clientes)
        messages: totalMessages ?? 0, // total de mensajes
      },
      recent,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
