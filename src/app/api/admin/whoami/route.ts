// src/app/api/admin/whoami/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function GET() {
  const cookieStore = await cookies();
  const active = cookieStore.get("pyme.active_tenant")?.value || null;

  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          cookieStore.set({ name, value: "", ...options });
        },
      },
    }
  );

  // Si no hay cookie, caer al primer tenant activo para no bloquear el dashboard
  let tenantId = active;

  if (!tenantId) {
    const { data, error } = await sb
      .from("tenants")
      .select("id")
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[whoami] error buscando tenant activo:", error);
    }

    tenantId = data?.id || null;

    if (tenantId) {
      cookieStore.set({
        name: "pyme.active_tenant",
        value: tenantId,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 180, // 180 días
      });
    }
  }

  if (!tenantId) {
    return NextResponse.json(
      { ok: false, error: "NO_TENANT" },
      { status: 404 }
    );
  }

  // Cargamos info del tenant, incluyendo estado de WhatsApp
  const { data: tenant, error: tenantError } = await sb
    .from("tenants")
    .select("id, name, wa_connected, wa_phone, wa_last_connected_at")
    .eq("id", tenantId)
    .maybeSingle();

  if (tenantError || !tenant) {
    console.error("[whoami] error cargando tenant:", tenantError);
    return NextResponse.json(
      { ok: false, error: "TENANT_NOT_FOUND" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    tenantId: tenant.id,
    tenantName: tenant.name ?? null,
    waConnected: !!tenant.wa_connected,
    waPhone: tenant.wa_phone ?? null,
    waLastConnectedAt: tenant.wa_last_connected_at ?? null,
  });
}
