// src/app/api/wa/session/route.ts
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import {
  getOrCreateSession,
  disconnectSession,
} from "@/server/whatsapp/baileysManager";

export const runtime = "nodejs";

type SessionStatus =
  | "disconnected"
  | "qrcode"
  | "connecting"
  | "connected"
  | "error";

interface SessionDTO {
  id: string;
  status: SessionStatus;
  qr_svg?: string | null;
  qr_data?: string | null;
  phone_number?: string | null;
  last_connected_at?: string | null;
}

interface TenantMeta {
  id: string;
  name?: string | null;
  wa_connected?: boolean | null;
  wa_phone?: string | null;
  wa_last_connected_at?: string | null;
}

/**
 * Carga los datos básicos del tenant, incluyendo flags de WhatsApp.
 */
async function fetchTenantMeta(tenantId: string): Promise<TenantMeta> {
  const { data, error } = await supabaseAdmin
    .from("tenants")
    .select("id, name, wa_connected, wa_phone, wa_last_connected_at")
    .eq("id", tenantId)
    .maybeSingle();

  if (error || !data) {
    throw new Error(
      `TENANT_NOT_FOUND: ${error?.message ?? "no se encontró el tenant"}`,
    );
  }

  return data;
}

/**
 * Asegura que exista una fila de whatsapp_sessions para un tenant.
 * Si ya existe, la devuelve; si no, crea una nueva básica.
 *
 * IMPORTANTE: si el tenant ya tiene wa_connected = TRUE, la fila nueva
 * se crea marcando status = 'connected' y copiando wa_phone/wa_last_connected_at.
 */
async function ensureSessionRow(tenant: TenantMeta) {
  const tenantId = tenant.id;

  // 1) ¿Ya existe una sesión para este tenant?
  const { data: existing, error } = await supabaseAdmin
    .from("whatsapp_sessions")
    .select(
      "id, tenant_id, status, qr_data, qr_svg, phone_number, last_connected_at",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `ERROR_LOADING_SESSION_ROW: ${error.message ?? String(error)}`,
    );
  }

  if (existing) return existing;

  // 2) Crear una nueva sesión
  const id = randomUUID();

  const initialStatus: SessionStatus = tenant.wa_connected ? "connected" : "disconnected";

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("whatsapp_sessions")
    .insert({
      id,
      tenant_id: tenantId,
      status: initialStatus,
      is_active: true,
      label: "Principal",
      phone_number: tenant.wa_phone ?? null,
      last_connected_at: tenant.wa_last_connected_at ?? null,
    })
    .select(
      "id, tenant_id, status, qr_data, qr_svg, phone_number, last_connected_at",
    )
    .single();

  if (insertError || !inserted) {
    throw new Error(
      `ERROR_CREATING_SESSION_ROW: ${
        insertError?.message ?? "sin detalles"
      }`,
    );
  }

  return inserted;
}

/**
 * Mapea la fila de BD al DTO que espera el frontend.
 * Si el tenant tiene wa_connected = TRUE, forzamos status = "connected"
 * y usamos wa_phone / wa_last_connected_at como fuente de verdad.
 */
function mapRowToSessionDTO(row: any, tenant?: TenantMeta): SessionDTO {
  const tenantConnected = !!tenant?.wa_connected;

  const status: SessionStatus = tenantConnected
    ? "connected"
    : ((row?.status as SessionStatus) || "disconnected");

  const phone =
    (tenantConnected ? tenant?.wa_phone : undefined) ??
    row?.phone_number ??
    null;

  const lastConnected =
    (tenantConnected ? tenant?.wa_last_connected_at : undefined) ??
    row?.last_connected_at ??
    null;

  return {
    id: row.id,
    status,
    qr_data: tenantConnected ? null : row.qr_data ?? null,
    qr_svg: tenantConnected ? null : row.qr_svg ?? null,
    phone_number: phone,
    last_connected_at: lastConnected,
  };
}

/**
 * GET /api/wa/session?tenantId=...
 * - Lee el tenant (incluye wa_connected/wa_phone).
 * - Asegura que exista whatsapp_sessions para ese tenant.
 * - Si el tenant NO está conectado (wa_connected = false),
 *   levanta/recupera la sesión de Baileys y genera QR si hace falta.
 * - Devuelve estado + QR de ese negocio.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantId = url.searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json(
        { ok: false, session: null, error: "TENANT_ID_REQUIRED" },
        { status: 400 },
      );
    }

    // 0) Cargamos info del tenant
    const tenant = await fetchTenantMeta(tenantId);

    // 1) Aseguramos fila de sesión en BD
    let row = await ensureSessionRow(tenant);

    // 2) Si el tenant NO está conectado por el servidor central
    //    entonces sí levantamos Baileys multi-sesión.
    if (!tenant.wa_connected) {
      try {
        await getOrCreateSession(row.id, tenantId);
      } catch (e: any) {
        console.error("[api/wa/session:GET] getOrCreateSession error:", e);
        // Marcamos error de backend WA pero no tiramos el server abajo
        return NextResponse.json(
          {
            ok: false,
            session: mapRowToSessionDTO(row, tenant),
            error: "WA_SESSION_ERROR",
            details: String(e?.message || e),
          },
          { status: 502 },
        );
      }

      // 3) Volvemos a leer la fila para coger status/qr actualizados
      const { data: refreshed, error: refreshError } = await supabaseAdmin
        .from("whatsapp_sessions")
        .select(
          "id, tenant_id, status, qr_data, qr_svg, phone_number, last_connected_at",
        )
        .eq("id", row.id)
        .maybeSingle();

      if (refreshError || !refreshed) {
        console.error(
          "[api/wa/session:GET] error refrescando fila:",
          refreshError,
        );
      } else {
        row = refreshed;
      }
    }

    const session = mapRowToSessionDTO(row, tenant);

    return NextResponse.json(
      {
        ok: true,
        session,
        error: null,
      },
      { status: 200 },
    );
  } catch (err: any) {
    console.error("[api/wa/session:GET] internal error:", err);
    return NextResponse.json(
      {
        ok: false,
        session: null,
        error: "internal_error",
        details: String(err?.message || err),
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/wa/session
 * Body: { tenantId, action: "connect" | "disconnect" }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const tenantId: string | undefined = body?.tenantId;
    const action: "connect" | "disconnect" | undefined = body?.action;

    if (!tenantId) {
      return NextResponse.json(
        { ok: false, session: null, error: "TENANT_ID_REQUIRED" },
        { status: 400 },
      );
    }

    if (!action) {
      return NextResponse.json(
        { ok: false, session: null, error: "ACTION_REQUIRED" },
        { status: 400 },
      );
    }

    // 0) Info del tenant
    const tenant = await fetchTenantMeta(tenantId);

    // 1) Aseguramos fila de sesión
    const row = await ensureSessionRow(tenant);

    if (action === "connect") {
      // Si ya está conectado por el servidor central (wa_server.js),
      // no intentamos levantar otra sesión por Baileys multi-sesión.
      if (!tenant.wa_connected) {
        try {
          await getOrCreateSession(row.id, tenantId);
        } catch (e: any) {
          console.error("[api/wa/session:POST] getOrCreateSession error:", e);
          return NextResponse.json(
            {
              ok: false,
              session: mapRowToSessionDTO(row, tenant),
              error: "WA_SESSION_ERROR",
              details: String(e?.message || e),
            },
            { status: 502 },
          );
        }
      }
    } else if (action === "disconnect") {
      // Desconectamos solo la sesión local de Baileys.
      // El flag tenants.wa_connected lo gestiona el servidor WA central.
      try {
        await disconnectSession(row.id);
      } catch (e: any) {
        console.error("[api/wa/session:POST] disconnectSession error:", e);
        return NextResponse.json(
          {
            ok: false,
            session: mapRowToSessionDTO(row, tenant),
            error: "WA_DISCONNECT_ERROR",
            details: String(e?.message || e),
          },
          { status: 502 },
        );
      }
    }

    // 2) Leemos estado actualizado (puede haber cambiado whatsapp_sessions)
    const { data: refreshed, error } = await supabaseAdmin
      .from("whatsapp_sessions")
      .select(
        "id, tenant_id, status, qr_data, qr_svg, phone_number, last_connected_at",
      )
      .eq("id", row.id)
      .maybeSingle();

    const effectiveRow = refreshed ?? row;

    if (error && !refreshed) {
      console.error("[api/wa/session:POST] error refrescando fila:", error);
      return NextResponse.json(
        {
          ok: false,
          session: null,
          error: "SESSION_REFRESH_ERROR",
          details: error?.message ?? null,
        },
        { status: 500 },
      );
    }

    const session = mapRowToSessionDTO(effectiveRow, tenant);

    return NextResponse.json(
      {
        ok: true,
        session,
        error: null,
      },
      { status: 200 },
    );
  } catch (err: any) {
    console.error("[api/wa/session:POST] internal error:", err);
    return NextResponse.json(
      {
        ok: false,
        session: null,
        error: "internal_error",
        details: String(err?.message || err),
      },
      { status: 500 },
    );
  }
}
