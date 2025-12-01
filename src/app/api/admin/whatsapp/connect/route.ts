// src/app/api/admin/whatsapp/connect/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getOrCreateSession } from "@/server/whatsapp/baileysManager";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const tenantId = body?.tenantId as string | undefined;

    if (!tenantId) {
      return NextResponse.json(
        { ok: false, error: "missing_tenant" },
        { status: 400 }
      );
    }

    // 1) Buscar sesión ya creada para este tenant
    let { data: session, error } = await supabaseAdmin
      .from("whatsapp_sessions")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) {
      console.error("[wa/connect] error select:", error);
      return NextResponse.json(
        { ok: false, error: "db_error" },
        { status: 500 }
      );
    }

    // 2) Si no existe, crear una nueva fila
    if (!session) {
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from("whatsapp_sessions")
        .insert({
          tenant_id: tenantId,
          status: "starting",
        })
        .select("*")
        .single();

      if (insertError || !inserted) {
        console.error("[wa/connect] error insert:", insertError);
        return NextResponse.json(
          { ok: false, error: "db_insert_error" },
          { status: 500 }
        );
      }

      session = inserted;
    }

    // 3) Iniciar / reutilizar la sesión Baileys (esto dispara los QR)
    await getOrCreateSession(session.id, tenantId);

    return NextResponse.json({
      ok: true,
      sessionId: session.id,
    });
  } catch (e) {
    console.error("[wa/connect] exception:", e);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 }
    );
  }
}
