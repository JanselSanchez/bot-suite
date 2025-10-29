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

  // Usa SERVICE ROLE para evitar números en 0 por RLS/cache
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // -------- TOTALES (lo que el dashboard mostrará) --------
  // bookings del tenant actual
  const { count: totalBookings, error: eBk } = await sb
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  // clientes = total de tenants en tu plataforma (como pediste)
  const { count: totalTenants, error: eTen } = await sb
    .from("tenants")
    .select("id", { count: "exact", head: true });

  // mensajes = total platform-wide
  const { count: totalMessages, error: eMsg } = await sb
    .from("messages")
    .select("id", { count: "exact", head: true });

  // actividad reciente: últimas 5 bookings del tenant
  const { data: recentBookings, error: eRecent } = await sb
    .from("bookings")
    .select("id, customer_name, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (eBk || eTen || eMsg || eRecent) {
    console.error("[/api/admin/dashboard/summary] ERR", {
      eBk, eTen, eMsg, eRecent, tenantId
    });
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
        bookings: totalBookings ?? 0,
        tenants: totalTenants ?? 0,
        messages: totalMessages ?? 0,
      },
      recent,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
