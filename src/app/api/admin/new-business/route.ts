// src/app/api/admin/new-business/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeWhatsapp(raw: string | null | undefined) {
  const s = (raw || "").trim();
  if (!s) return null;
  if (s.toLowerCase().startsWith("whatsapp:")) return s;

  const digits = s.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return `whatsapp:${digits}`;
  if (/^\d{10}$/.test(digits)) return `whatsapp:+1${digits}`;
  return `whatsapp:${digits}`;
}

export async function POST(req: Request) {
  const cookieStore = await cookies();

  // ✅ Supabase SSR (validar usuario)
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
    }
  );

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (!user || userErr) {
    return NextResponse.json({ ok: false, error: "not-auth" }, { status: 401 });
  }

  // Body
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const name = (body?.name ?? "").toString().trim();
  const timezone = (body?.timezone ?? "America/Santo_Domingo").toString().trim() || "America/Santo_Domingo";
  const vertical = (body?.vertical ?? "general").toString().trim() || "general";
  const description = (body?.description ?? "").toString().trim() || null;
  const notification_email = (body?.notification_email ?? "").toString().trim() || null;
  const phone = normalizeWhatsapp(body?.phone);

  if (!name) {
    return NextResponse.json({ ok: false, error: "Nombre obligatorio" }, { status: 400 });
  }

  // ✅ Admin client (SERVICE ROLE)
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error("Missing env: SUPABASE_SERVICE_ROLE_KEY");
    return NextResponse.json({ ok: false, error: "server-misconfigured" }, { status: 500 });
  }

  const sbAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { persistSession: false } }
  );

  // Insert tenant
  const { data: tenant, error: insErr } = await sbAdmin
    .from("tenants")
    .insert({
      name,
      timezone,
      phone,
      status: "active",
      owner_id: user.id,
      vertical,
      description,
      notification_email,
    })
    .select("id")
    .single();

  if (insErr || !tenant) {
    console.error("Error creando tenant:", insErr);
    return NextResponse.json(
      { ok: false, error: insErr?.message ?? "No se pudo crear" },
      { status: 500 }
    );
  }

  // Membership (no silencioso)
  const { error: memErr } = await sbAdmin
    .from("tenant_members")
    .insert({ tenant_id: tenant.id, user_id: user.id, role: "owner" });

  if (memErr) {
    console.error("Error creando tenant_members:", memErr);
    return NextResponse.json(
      { ok: false, error: memErr.message ?? "No se pudo crear membresía" },
      { status: 500 }
    );
  }

  // Cookie tenant activo
  cookieStore.set("pyme.active_tenant", tenant.id, {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });

  return NextResponse.json({ ok: true, tenantId: tenant.id });
}
