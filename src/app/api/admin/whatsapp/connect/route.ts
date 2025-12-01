// src/app/api/admin/whatsapp/connect/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getOrCreateSession } from "@/server/whatsapp/baileysManager";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { tenantId, sessionId } = body as {
      tenantId?: string;
      sessionId?: string;
    };

    if (!tenantId || !sessionId) {
      return NextResponse.json(
        { ok: false, error: "missing_tenant_or_session" },
        { status: 400 }
      );
    }

    // Verificar que la sesión exista en la tabla whatsapp_sessions
    const { data: sessionRow, error } = await supabaseAdmin
      .from("whatsapp_sessions")
      .select("id, status")
      .eq("id", sessionId)
      .maybeSingle();

    if (error || !sessionRow) {
      return NextResponse.json(
        { ok: false, error: "session_not_found" },
        { status: 404 }
      );
    }

    // 👉 Aquí SÍ arrancamos o reutilizamos la sesión de Baileys
    await getOrCreateSession(sessionId, tenantId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/whatsapp/connect] error:", err);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 }
    );
  }
}
