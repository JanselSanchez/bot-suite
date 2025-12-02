// src/app/api/wa/session/route.ts
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import {
  getOrCreateSession,
  disconnectSession,
} from "@/server/whatsapp/baileysManager";

type SessionStatus =
  | "disconnected"
  | "qrcode"
  | "connecting"
  | "connected"
  | "error";

interface SessionDTO {
  id: string;
  status: SessionStatus;
  qr_data?: string | null;
  qr_svg?: string | null;
  phone_number?: string | null;
  last_connected_at?: string | null;
}

type SessionResponse =
  | {
      ok: true;
      session: SessionDTO | null;
    }
  | {
      ok: false;
      error: string;
    };

/**
 * GET /api/wa/session?tenantId=...
 *
 * SOLO LEE de la tabla whatsapp_sessions.
 * No toca Baileys, no crea sockets, no genera QR.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get("tenantId");

  if (!tenantId) {
    return NextResponse.json<SessionResponse>(
      { ok: false, error: "Falta tenantId" },
      { status: 400 }
    );
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("whatsapp_sessions")
      .select(
        "id, status, qr_data, qr_svg, phone_number, last_connected_at"
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[wa/session][GET] error:", error);
      return NextResponse.json<SessionResponse>(
        { ok: false, error: "Error leyendo sesión" },
        { status: 500 }
      );
    }

    if (!data) {
      // El negocio aún no tiene sesión creada
      return NextResponse.json<SessionResponse>({
        ok: true,
        session: null,
      });
    }

    const session: SessionDTO = {
      id: data.id,
      status: data.status as SessionStatus,
      qr_data: data.qr_data,
      qr_svg: data.qr_svg,
      phone_number: data.phone_number,
      last_connected_at: data.last_connected_at,
    };

    return NextResponse.json<SessionResponse>({
      ok: true,
      session,
    });
  } catch (err) {
    console.error("[wa/session][GET] unexpected error:", err);
    return NextResponse.json<SessionResponse>(
      { ok: false, error: "Error inesperado" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/wa/session
 *
 * body: { tenantId: string, action: "connect" | "disconnect" }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { tenantId, action } = body as {
      tenantId?: string;
      action?: "connect" | "disconnect";
    };

    if (!tenantId || !action) {
      return NextResponse.json<SessionResponse>(
        { ok: false, error: "Faltan tenantId o action" },
        { status: 400 }
      );
    }

    if (action === "connect") {
      // 1) Buscar sesión existente del tenant
      const { data: existing, error: queryError } = await supabaseAdmin
        .from("whatsapp_sessions")
        .select("id, status")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (queryError) {
        console.error("[wa/session][POST][connect] query error:", queryError);
        return NextResponse.json<SessionResponse>(
          { ok: false, error: "Error buscando sesión" },
          { status: 500 }
        );
      }

      let sessionId = existing?.id ?? randomUUID();

      // 2) UPSERT de la fila en whatsapp_sessions
      const { error: upsertError } = await supabaseAdmin
        .from("whatsapp_sessions")
        .upsert(
          {
            id: sessionId,
            tenant_id: tenantId,
            status: "connecting",
            qr_data: null,
            qr_svg: null,
            last_error: null,
          },
          { onConflict: "id" }
        );

      if (upsertError) {
        console.error("[wa/session][POST][connect] upsert error:", upsertError);
        return NextResponse.json<SessionResponse>(
          { ok: false, error: "Error creando sesión" },
          { status: 500 }
        );
      }

      // 3) Llamar a Baileys para iniciar / reutilizar la sesión
      //    Esto dispara los connection.update (incluyendo el QR).
      try {
        await getOrCreateSession(sessionId, tenantId);
      } catch (err) {
        console.error("[wa/session][POST][connect] Baileys error:", err);
        return NextResponse.json<SessionResponse>(
          { ok: false, error: "Error inicializando Baileys" },
          { status: 500 }
        );
      }

      return NextResponse.json<SessionResponse>({
        ok: true,
        session: {
          id: sessionId,
          status: "connecting",
        },
      });
    }

    if (action === "disconnect") {
      // 1) Buscar sesión actual del tenant
      const { data: existing, error: queryError } = await supabaseAdmin
        .from("whatsapp_sessions")
        .select("id")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (queryError) {
        console.error("[wa/session][POST][disconnect] query error:", queryError);
        return NextResponse.json<SessionResponse>(
          { ok: false, error: "Error buscando sesión" },
          { status: 500 }
        );
      }

      if (existing?.id) {
        try {
          await disconnectSession(existing.id);
        } catch (err) {
          console.error(
            "[wa/session][POST][disconnect] disconnectSession error:",
            err
          );
        }
      }

      // 2) Marcar en BD como desconectada
      const { error: updateError } = await supabaseAdmin
        .from("whatsapp_sessions")
        .update({
          status: "disconnected",
          qr_data: null,
          qr_svg: null,
          last_seen_at: new Date(),
        })
        .eq("tenant_id", tenantId);

      if (updateError) {
        console.error(
          "[wa/session][POST][disconnect] update error:",
          updateError
        );
      }

      // Marcar también el tenant como desconectado
      await supabaseAdmin
        .from("tenants")
        .update({ wa_connected: false })
        .eq("id", tenantId);

      return NextResponse.json<SessionResponse>({
        ok: true,
        session: null,
      });
    }

    // Acción no soportada
    return NextResponse.json<SessionResponse>(
      { ok: false, error: "Acción no soportada" },
      { status: 400 }
    );
  } catch (err) {
    console.error("[wa/session][POST] unexpected error:", err);
    return NextResponse.json<SessionResponse>(
      { ok: false, error: "Error inesperado" },
      { status: 500 }
    );
  }
}
