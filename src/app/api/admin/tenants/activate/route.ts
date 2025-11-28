// src/app/api/admin/tenants/activate/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { cookies } from "next/headers";

export const runtime = "nodejs";

/**
 * POST /api/admin/tenants/activate
 * Body: { tenantId }
 *
 * - Valida que el tenant exista.
 * - Guarda cookie httpOnly "pyme.active_tenant" por 180 días.
 */
export async function POST(req: Request) {
  try {
    const { tenantId } = await req.json().catch(() => ({} as any));

    if (!tenantId || typeof tenantId !== "string") {
      return NextResponse.json(
        { ok: false, error: "tenantId required" },
        { status: 400 },
      );
    }

    // Validamos tenant usando service role (no lee cookies de sesión)
    const { data, error } = await supabaseAdmin
      .from("tenants")
      .select("id")
      .eq("id", tenantId)
      .maybeSingle();

    if (error) {
      console.error("[tenants/activate] supabaseAdmin error:", error);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        { ok: false, error: "TENANT_NOT_FOUND" },
        { status: 404 },
      );
    }

    const res = NextResponse.json({ ok: true, tenantId });

    // Cookie con tenant activo
    res.cookies.set("pyme.active_tenant", tenantId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 180, // 180 días
    });

    return res;
  } catch (err: any) {
    console.error("[tenants/activate:POST] internal error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "internal_error",
        details: String(err?.message || err),
      },
      { status: 500 },
    );
  }
}

/**
 * GET /api/admin/tenants/activate
 *
 * - Lee la cookie "pyme.active_tenant"
 * - Devuelve { ok, tenantId, tenantName? }
 */
export async function GET() {
  try {
    const cookieStore = await cookies();
    const tenantId = cookieStore.get("pyme.active_tenant")?.value || null;

    if (!tenantId) {
      return NextResponse.json(
        { ok: false, tenantId: null, error: "NO_ACTIVE_TENANT" },
        { status: 200 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("tenants")
      .select("id, name")
      .eq("id", tenantId)
      .maybeSingle();

    if (error) {
      console.error("[tenants/activate:GET] supabaseAdmin error:", error);
      return NextResponse.json(
        { ok: false, tenantId, error: error.message },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        { ok: false, tenantId: null, error: "TENANT_NOT_FOUND" },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        tenantId: data.id,
        tenantName: data.name ?? data.id,
      },
      { status: 200 },
    );
  } catch (err: any) {
    console.error("[tenants/activate:GET] internal error:", err);
    return NextResponse.json(
      {
        ok: false,
        tenantId: null,
        error: "internal_error",
        details: String(err?.message || err),
      },
      { status: 500 },
    );
  }
}
