// src/app/api/admin/whatsapp/connect/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getOrCreateSession } from "@/server/whatsapp/baileysManager";

/**
 * POST /api/admin/whatsapp/connect
 *
 * Body: { tenantId: string }
 *
 * - Busca (o crea) una fila en whatsapp_sessions para ese tenant.
 * - Llama a Baileys para iniciar la sesión y generar el QR.
 * - El panel solo tiene que hacer polling a /status para leer el QR desde la DB.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { tenantId } = body as { tenantId?: string };

    if (!tenantId) {
      return NextResponse.json(
        { ok: false, error: "missing_tenant" },
        { status: 400 }
      );
    }

    // 1) Buscar sesión existente de ese tenant
    const { data: existing, error: findError } = await supabaseAdmin
      .from("whatsapp_sessions")
      .select("id, tenant_id, status")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (findError) {
      console.error("[wa-connect] error buscando sesión:", findError);
      return NextResponse.json(
        { ok: false, error: "db_error_find" },
        { status: 500 }
      );
    }

    let sessionId: string;

    if (existing?.id) {
      sessionId = existing.id;
    } else {
      // 2) Crear fila nueva para este tenant
      const { data: created, error: insertError } = await supabaseAdmin
        .from("whatsapp_sessions")
        .insert({
          tenant_id: tenantId,
          status: "starting",
        })
        .select("id")
        .single();

      if (insertError || !created) {
        console.error("[wa-connect] error creando sesión:", insertError);
        return NextResponse.json(
          { ok: false, error: "db_error_insert" },
          { status: 500 }
        );
      }

      sessionId = created.id;
    }

    // 3) Lanzar (o reutilizar) la sesión de Baileys → esto genera QR
    await getOrCreateSession(sessionId, tenantId);

    // 4) Devolver datos mínimos al frontend
    return NextResponse.json({
      ok: true,
      sessionId,
    });
  } catch (err) {
    console.error("[wa-connect] error inesperado:", err);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 }
    );
  }
}
