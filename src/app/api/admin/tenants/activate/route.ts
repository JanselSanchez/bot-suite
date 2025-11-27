import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { tenantId } = await req.json().catch(() => ({} as any));

    if (!tenantId || typeof tenantId !== "string") {
      return NextResponse.json(
        { ok: false, error: "tenantId required" },
        { status: 400 },
      );
    }

    // ✅ Usamos supabaseAdmin (service role), no lee cookies ni sesión
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

    // Creamos la respuesta y seteamos SOLO la cookie de tenant
    const res = NextResponse.json({ ok: true, tenantId });

    res.cookies.set("pyme.active_tenant", tenantId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 180, // 180 días
    });

    return res;
  } catch (err: any) {
    console.error("[tenants/activate] internal error:", err);
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
