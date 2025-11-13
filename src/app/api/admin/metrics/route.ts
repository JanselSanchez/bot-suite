// src/app/api/admin/metrics/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenantId")?.trim();

  if (!tenantId) {
    return NextResponse.json(
      { ok: false, error: "tenantId required" },
      { status: 400 }
    );
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, // SERVICE ROLE (server only)
    { auth: { persistSession: false } }
  );

  try {
    // Ejecutamos todo en paralelo
    const [
      bookingsCountRes,
      tenantsCountRes,
      messagesCountRes,
      recentRes,
    ] = await Promise.all([
      sb
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId),
      sb
        .from("tenants")
        .select("id", { count: "exact", head: true }),
      sb
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId), // ← si quieres global, elimina esta línea
      sb
        .from("bookings")
        .select("id, customer_name, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    const eBk = bookingsCountRes.error;
    const eTen = tenantsCountRes.error;
    const eMsg = messagesCountRes.error;
    const eRecent = recentRes.error;

    if (eBk || eTen || eMsg || eRecent) {
      console.error("[/api/admin/metrics] ERR", {
        tenantId,
        eBk: eBk?.message,
        eTen: eTen?.message,
        eMsg: eMsg?.message,
        eRecent: eRecent?.message,
      });
    }

    const recent =
      (recentRes.data ?? []).map((b: any) => ({
        id: b.id,
        title: `Nueva cita ${
          b.customer_name ? `de ${b.customer_name}` : `#${String(b.id).slice(0, 6)}`
        }`,
        created_at: b.created_at as string,
      })) ?? [];

    return NextResponse.json(
      {
        ok: true,
        totals: {
          bookings: bookingsCountRes.count ?? 0, // bookings del tenant
          tenants: tenantsCountRes.count ?? 0,   // total de tenants (global)
          messages: messagesCountRes.count ?? 0, // mensajes del tenant (o global si quitas eq)
        },
        recent,
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e: any) {
    console.error("[/api/admin/metrics] fatal", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}
