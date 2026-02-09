import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SupabaseInit =
  | { supabase: ReturnType<typeof createServerClient>; envError: null }
  | { supabase: null; envError: "SUPABASE_ENV_NOT_SET" };

async function getSupabase(): Promise<SupabaseInit> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    return { supabase: null, envError: "SUPABASE_ENV_NOT_SET" };
  }

  const cookieStore = await cookies();

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      },
    },
  });

  return { supabase, envError: null };
}

export async function POST(req: Request) {
  console.log("👉 [API ACTIVATE TENANT][POST] hit");

  try {
    const body = await req.json().catch(() => null);
    const tenantId = body?.tenantId;

    if (!tenantId || typeof tenantId !== "string") {
      return NextResponse.json({ ok: false, error: "tenantId requerido" }, { status: 400 });
    }

    const supa = await getSupabase();
    if (supa.envError) {
      return NextResponse.json({ ok: false, error: supa.envError }, { status: 500 });
    }

    const supabase = supa.supabase;
    const { data: userData, error: userErr } = await supabase.auth.getUser();

    if (userErr || !userData?.user) {
      return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    // 1. Buscamos info del Tenant
    let tenantName: string | null = null;
    const { data: tenantRow } = await supabase
      .from("tenants")
      .select("id,name")
      .eq("id", tenantId)
      .maybeSingle();

    if (tenantRow) tenantName = tenantRow.name;

    // 2. Buscamos info de sesión WA
    let waConnected = false;
    let waPhone: string | null = null;
    let waLastConnectedAt: string | null = null;

    const { data: waRow } = await supabase
      .from("wa_sessions") // Asegúrate que tu tabla se llame wa_sessions o whatsapp_sessions
      .select("connected, phone_number, last_connected_at")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (waRow) {
      waConnected = !!waRow.connected; // O ajusta según tu columna 'status'
      waPhone = waRow.phone_number;
      waLastConnectedAt = waRow.last_connected_at;
    }

    // 🔥🔥 LA PARTE CRÍTICA QUE FALTABA: GUARDAR LA COOKIE 🔥🔥
    const cookieStore = await cookies();
    cookieStore.set("pyme.active_tenant", tenantId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 180, // 180 días
    });
    // 🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥

    return NextResponse.json({
      ok: true,
      tenantId,
      tenantName,
      waConnected,
      waPhone,
      waLastConnectedAt,
    });

  } catch (error: any) {
    console.error("💥 [API ACTIVATE TENANT][CRASH]:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
