import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // SERVER ONLY
);

const isUuid = (v?: string|null) =>
  !!v && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(v!);
const isIso = (v?: string|null) => !!v && !Number.isNaN(new Date(v!).getTime());

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId   = searchParams.get("tenantId");
    const resourceId = searchParams.get("resourceId"); // opcional
    const from       = searchParams.get("from");
    const to         = searchParams.get("to");

    if (!isUuid(tenantId)) return NextResponse.json({ error: "tenantId inválido" }, { status: 400 });
    if (!isIso(from) || !isIso(to)) return NextResponse.json({ error: "from/to inválidos" }, { status: 400 });
    if (resourceId && !isUuid(resourceId)) return NextResponse.json({ error: "resourceId inválido" }, { status: 400 });

    // 1) Query básica sin listar columnas (evita 500 por nombres)
    // 2) Filtro con fallback: primero *_uuid, luego sin sufijo si diera error 42703
    const base = () =>
      sb.from("bookings")
        .select("*")                                  // ← sin columnas explícitas
        .gte("starts_at", from!).lt("starts_at", to!) // rango semiabierto
        .order("starts_at", { ascending: true });

    // Intento 1: tenant_id_uuid (+ resource_id_uuid si viene)
    let q = base().eq("tenant_id_uuid", tenantId!);
    if (resourceId) q = q.eq("resource_id_uuid", resourceId);
    let { data, error } = await q;

    // Si la columna no existe (42703), probamos sin sufijo
    if (error && (error as any).code === "42703") {
      let q2 = base().eq("tenant_id", tenantId!);
      if (resourceId) q2 = q2.eq("resource_id", resourceId);
      ({ data, error } = await q2);
    }

    if (error) {
      return NextResponse.json(
        { error: "query_failed", supabase: { message: error.message, details: (error as any).details, hint: (error as any).hint, code: (error as any).code } },
        { status: 500 }
      );
    }

    // Normalización suave (soporta status_booking_status o status)
    const rows = (data ?? []).map((r: any) => ({
      id: r.id,
      tenant_id: r.tenant_id_uuid ?? r.tenant_id ?? null,
      service_id: r.service_id_uuid ?? r.service_id ?? null,
      resource_id: r.resource_id_uuid ?? r.resource_id ?? null,
      customer_name: r.customer_name ?? null,
      customer_phone: r.customer_phone ?? null,
      status: r.status_booking_status ?? r.status ?? null,
      starts_at: r.starts_at,
      ends_at: r.ends_at,
      notes: r.notes ?? null,
    }));

    return NextResponse.json({ data: rows }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: "unexpected_error", detail: String(e?.message || e) }, { status: 500 });
  }
}
