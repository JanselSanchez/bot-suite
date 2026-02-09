import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// Usamos createClient normal para evitar problemas de compilación
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!url || !key) return null;
  
  return createClient(url, key, {
    auth: { persistSession: false }
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { tenantId } = body;

    if (!tenantId || typeof tenantId !== "string") {
      return NextResponse.json({ ok: false, error: "Falta tenantId" }, { status: 400 });
    }

    // 1. Validar que el negocio existe
    const sbAdmin = getAdminClient();
    if (!sbAdmin) {
      return NextResponse.json({ ok: false, error: "Error servidor (env)" }, { status: 500 });
    }

    const { data: tenant, error } = await sbAdmin
      .from("tenants")
      .select("id, name")
      .eq("id", tenantId)
      .maybeSingle();

    if (error || !tenant) {
      return NextResponse.json({ ok: false, error: "Negocio no encontrado" }, { status: 404 });
    }

    // 2. GUARDAR LA COOKIE (La parte clave)
    const cookieStore = await cookies();
    cookieStore.set("pyme.active_tenant", tenantId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 180, // 180 días
    });

    return NextResponse.json({ 
      ok: true, 
      tenantId: tenant.id,
      tenantName: tenant.name 
    });

  } catch (error: any) {
    console.error("[activate] Error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const tenantId = cookieStore.get("pyme.active_tenant")?.value;

    if (!tenantId) {
      return NextResponse.json({ ok: false, tenantId: null }, { status: 200 });
    }

    return NextResponse.json({ ok: true, tenantId }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Error" }, { status: 500 });
  }
}
