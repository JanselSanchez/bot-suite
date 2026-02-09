import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bot server URL
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

function buildDisconnectedSession(tenantId: string | null, error: string) {
  return {
    id: tenantId ?? null,
    status: "disconnected",
    qr_data: null,
    phone_number: null,
    last_connected_at: null,
    error,
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
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

export async function GET(req: Request) {
  console.log("👉 [API WA SESSION][GET] hit");

  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("t") || searchParams.get("tenantId");

    console.log("👤 tenantId:", tenantId);
    console.log("🤖 WA_BOT_URL:", WA_BOT_URL);

    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "Falta tenantId" }, { status: 400 });
    }

    const targetUrl = `${WA_BOT_URL}/sessions/${encodeURIComponent(tenantId)}`;

    let res: Response;
    let raw = "";
    try {
      const out = await fetchWithTimeout(
        targetUrl,
        { headers: { "Content-Type": "application/json" } },
        5000
      );
      res = out.res;
      raw = out.raw;
    } catch (e: any) {
      console.error("❌ [API WA SESSION][GET] bot unreachable:", e?.message || e);
      return NextResponse.json({
        ok: true,
        session: buildDisconnectedSession(tenantId, "Bot server unreachable"),
      });
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      console.error(
        `🔥 [API WA SESSION][GET] bot non-JSON (status=${res.status}). preview=${raw.slice(0, 140)}`
      );
      return NextResponse.json({
        ok: true,
        session: buildDisconnectedSession(tenantId, "Bot server error (non-JSON)"),
      });
    }

    const data = safeJsonParse(raw);
    if (!data) {
      console.error(
        `🔥 [API WA SESSION][GET] invalid JSON (status=${res.status}). preview=${raw.slice(0, 140)}`
      );
      return NextResponse.json({
        ok: true,
        session: buildDisconnectedSession(tenantId, "Bot server invalid JSON"),
      });
    }

    const sessionData = data.session || data || {};

    return NextResponse.json({
      ok: true,
      session: {
        id: tenantId,
        status: sessionData.status || "disconnected",
        qr_data: sessionData.qr_data || sessionData.qr || null,
        phone_number: sessionData.phone_number || null,
        last_connected_at: sessionData.last_connected_at || null,
      },
    });
  } catch (error: any) {
    console.error("💥 [API WA SESSION][GET][CRASH]:", error);
    return NextResponse.json(
      { ok: false, error: "Error interno: " + (error?.message || String(error)) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  console.log("👉 [API WA SESSION][POST] hit");

  try {
    // IMPORTANTE: req.json() puede fallar si viene vacío/mal
    const body = await req.json().catch(() => null);

    const action = body?.action;
    const tenantId = body?.tenantId || body?.t || body?.id;

    console.log("👤 tenantId:", tenantId);
    console.log("🎬 action:", action);
    console.log("🤖 WA_BOT_URL:", WA_BOT_URL);

    if (!tenantId || !action) {
      return NextResponse.json(
        { ok: false, error: "Datos incompletos (tenantId/action)" },
        { status: 400 }
      );
    }

    const endpoint =
      action === "disconnect"
        ? `${WA_BOT_URL}/sessions/${encodeURIComponent(tenantId)}/disconnect`
        : `${WA_BOT_URL}/sessions/${encodeURIComponent(tenantId)}/connect`;

    let res: Response;
    let raw = "";
    try {
      const out = await fetchWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        8000
      );
      res = out.res;
      raw = out.raw;
    } catch (e: any) {
      console.error("❌ [API WA SESSION][POST] bot unreachable:", e?.message || e);
      // 👇 NO devolvemos 500; tu UI se rompe si ve ok:false/500
      return NextResponse.json({
        ok: true,
        session: buildDisconnectedSession(tenantId, "Bot server unreachable"),
      });
    }

    const contentType = res.headers.get("content-type") || "";

    // Si el bot devolvió no-JSON (HTML/502), NO tiramos 500.
    if (!contentType.includes("application/json")) {
      console.error(
        `🔥 [API WA SESSION][POST] bot non-JSON (status=${res.status}). preview=${raw.slice(0, 140)}`
      );
      return NextResponse.json({
        ok: true,
        session: buildDisconnectedSession(tenantId, "Bot server error (non-JSON)"),
      });
    }

    const data = safeJsonParse(raw);
    if (!data) {
      console.error(
        `🔥 [API WA SESSION][POST] invalid JSON (status=${res.status}). preview=${raw.slice(0, 140)}`
      );
      return NextResponse.json({
        ok: true,
        session: buildDisconnectedSession(tenantId, "Bot server invalid JSON"),
      });
    }

    const sessionData = data.session || data || {};

    // Respuesta final alineada con tu UI
    return NextResponse.json({
      ok: true,
      session: {
        id: tenantId,
        status: sessionData.status || (action === "disconnect" ? "disconnected" : "connecting"),
        qr_data: sessionData.qr_data || sessionData.qr || null,
        phone_number: sessionData.phone_number || null,
        last_connected_at: sessionData.last_connected_at || null,
      },
    });
  } catch (error: any) {
    console.error("💥 [API WA SESSION][POST][CRASH]:", error);
    // Aquí sí es crash real del handler
    return NextResponse.json(
      { ok: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
