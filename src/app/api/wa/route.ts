// src/app/api/wa/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ServerStatus = {
  ok: boolean;
  status: "online" | "offline";
  error?: string | null;
  details?: string | null;
};

const WA_BOT_URL = (
  process.env.WA_SERVER_URL ||
  process.env.NEXT_PUBLIC_WA_SERVER_URL ||
  "http://localhost:4001"
).replace(/\/$/, "");

function safeJsonParse(raw: string) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function disconnectedSession(tenantId: string | null, reason: string) {
  return {
    ok: true,
    session: {
      id: tenantId ?? null,
      status: "disconnected",
      qr_data: null,
      phone_number: null,
      last_connected_at: null,
      error: reason,
    },
  };
}

async function fetchTextWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    const raw = await res.text();
    return { res, raw };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Decide si esta request es para "session" basándonos en cómo tu frontend la está llamando:
 * - /api/wa?session?t=...
 * - /api/wa?session=1&tenantId=...
 * - /api/wa?tenantId=...
 */
function isSessionRequest(url: URL) {
  const sp = url.searchParams;
  // algunos builds tiran "?session" como flag sin valor
  const hasSessionFlag =
    sp.has("session") ||
    url.search.includes("session?") || // por tu screenshot "session?t=..."
    url.search.includes("session=");

  const hasTenant =
    sp.has("tenantId") || sp.has("t");

  // Si trae tenantId o el flag session, tratamos como session.
  return hasSessionFlag || hasTenant;
}

/**
 * GET Session handler
 */
async function handleGetSession(req: Request) {
  const url = new URL(req.url);
  const sp = url.searchParams;
  const tenantId = sp.get("tenantId") || sp.get("t");

  if (!tenantId) {
    return NextResponse.json(
      { ok: false, error: "Falta tenantId" },
      { status: 200 }
    );
  }

  const targetUrl = `${WA_BOT_URL}/sessions/${encodeURIComponent(tenantId)}`;

  try {
    const { res, raw } = await fetchTextWithTimeout(
      targetUrl,
      { headers: { "Content-Type": "application/json" } },
      6000
    );

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      console.error("[api/wa:getSession] non-JSON from bot:", res.status, raw.slice(0, 160));
      return NextResponse.json(disconnectedSession(tenantId, "Bot server non-JSON"), { status: 200 });
    }

    const data = safeJsonParse(raw);
    if (!data) {
      console.error("[api/wa:getSession] invalid JSON from bot:", res.status, raw.slice(0, 160));
      return NextResponse.json(disconnectedSession(tenantId, "Bot server invalid JSON"), { status: 200 });
    }

    const s = data.session || data || {};
    return NextResponse.json(
      {
        ok: true,
        session: {
          id: tenantId,
          status: s.status || "disconnected",
          qr_data: s.qr_data || s.qr || null,
          phone_number: s.phone_number || null,
          last_connected_at: s.last_connected_at || null,
        },
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[api/wa:getSession] fetch error:", err?.message || err);
    return NextResponse.json(disconnectedSession(tenantId, "Bot server unreachable"), { status: 200 });
  }
}

/**
 * POST Session handler (connect/disconnect)
 */
async function handlePostSession(req: Request) {
  const url = new URL(req.url);

  const body = await req.json().catch(() => null);
  const action = body?.action;
  const tenantId = body?.tenantId || body?.t || body?.id || url.searchParams.get("tenantId") || url.searchParams.get("t");

  if (!tenantId || !action) {
    return NextResponse.json(
      disconnectedSession(tenantId ?? null, "Datos incompletos (tenantId/action)"),
      { status: 200 }
    );
  }

  const endpoint =
    action === "disconnect"
      ? `${WA_BOT_URL}/sessions/${encodeURIComponent(tenantId)}/disconnect`
      : `${WA_BOT_URL}/sessions/${encodeURIComponent(tenantId)}/connect`;

  try {
    const { res, raw } = await fetchTextWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      8000
    );

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      console.error("[api/wa:postSession] non-JSON from bot:", res.status, raw.slice(0, 160));
      return NextResponse.json(disconnectedSession(tenantId, "Bot server non-JSON"), { status: 200 });
    }

    const data = safeJsonParse(raw);
    if (!data) {
      console.error("[api/wa:postSession] invalid JSON from bot:", res.status, raw.slice(0, 160));
      return NextResponse.json(disconnectedSession(tenantId, "Bot server invalid JSON"), { status: 200 });
    }

    const s = data.session || data || {};
    return NextResponse.json(
      {
        ok: true,
        session: {
          id: tenantId,
          status: s.status || (action === "disconnect" ? "disconnected" : "connecting"),
          qr_data: s.qr_data || s.qr || null,
          phone_number: s.phone_number || null,
          last_connected_at: s.last_connected_at || null,
        },
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[api/wa:postSession] fetch error:", err?.message || err);
    return NextResponse.json(disconnectedSession(tenantId, "Bot server unreachable"), { status: 200 });
  }
}

/**
 * Health handler (tu lógica original, pero usando WA_BOT_URL)
 */
async function handleHealth() {
  if (!WA_BOT_URL) {
    const body: ServerStatus = {
      ok: false,
      status: "offline",
      error: "WA_SERVER_URL_NOT_SET",
      details: "Configura WA_SERVER_URL en .env",
    };
    return NextResponse.json(body, { status: 200 });
  }

  try {
    const { res, raw } = await fetchTextWithTimeout(
      `${WA_BOT_URL}/health`,
      { method: "GET" },
      5000
    );

    const data = safeJsonParse(raw);
    const isOk = res.ok && !!data?.ok;

    const body: ServerStatus = {
      ok: isOk,
      status: isOk ? "online" : "offline",
      error: isOk ? null : "WA_SERVER_HEALTH_ERROR",
      details: isOk ? null : `Status HTTP: ${res.status}`,
    };

    return NextResponse.json(body, { status: 200 });
  } catch (err: any) {
    console.error("[api/wa:GET health] error:", err);
    const body: ServerStatus = {
      ok: false,
      status: "offline",
      error: "WA_SERVER_UNREACHABLE",
      details: String(err?.message || err),
    };
    return NextResponse.json(body, { status: 200 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  // ✅ Si viene como session (como tu UI lo está llamando), lo atendemos aquí
  if (isSessionRequest(url)) {
    return handleGetSession(req);
  }

  // ✅ Si no, es health
  return handleHealth();
}

export async function POST(req: Request) {
  const url = new URL(req.url);

  // ✅ Tu UI está posteando a /api/wa (no /api/wa/session), así que lo soportamos
  if (isSessionRequest(url)) {
    return handlePostSession(req);
  }

  // Si alguien POSTea sin session, respondemos 200 para no romper UI
  return NextResponse.json(
    { ok: false, error: "POST no soportado sin session" },
    { status: 200 }
  );
}
