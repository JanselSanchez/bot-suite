// src/app/api/admin/tenants/activate/route.ts
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

  // ✅ Next 15 puede tipar cookies() como Promise
  const cookieStore = await cookies();

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
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
      return NextResponse.json(
        {
          ok: false,
          error: supa.envError,
          details: "Configura NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY",
        },
        { status: 500 }
      );
    }

    const supabase = supa.supabase;

    // ✅ Auth real
    const { data: userData, error: userErr } = await supabase.auth.getUser();

    if (userErr) {
      console.error("❌ [API ACTIVATE TENANT] getUser error:", userErr);
      return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }
    if (!userData?.user) {
      return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    // -------- Tenant info (no fatal) --------
    let tenantName: string | null = null;
    try {
      const { data: tenantRow, error: tenantErr } = await supabase
        .from("tenants")
        .select("id,name")
        .eq("id", tenantId)
        .maybeSingle();

      if (tenantErr) {
        console.warn("⚠️ [API ACTIVATE TENANT] tenants lookup warn:", tenantErr);
      } else {
        tenantName = tenantRow?.name ?? null;
      }
    } catch (e) {
      console.warn("⚠️ [API ACTIVATE TENANT] tenants lookup crash:", e);
    }

    // -------- WA session state (no fatal) --------
    let waConnected = false;
    let waPhone: string | null = null;
    let waLastConnectedAt: string | null = null;

    try {
      const { data: waRow, error: waErr } = await supabase
        .from("wa_sessions")
        .select("tenant_id, connected, phone_number, last_connected_at")
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (waErr) {
        console.warn("⚠️ [API ACTIVATE TENANT] wa_sessions warn:", waErr);
      } else if (waRow) {
        waConnected = !!waRow.connected;
        waPhone = waRow.phone_number ?? null;
        waLastConnectedAt = waRow.last_connected_at ?? null;
      }
    } catch (e) {
      console.warn("⚠️ [API ACTIVATE TENANT] wa_sessions crash:", e);
    }

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
