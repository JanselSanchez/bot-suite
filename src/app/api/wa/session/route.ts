import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function disconnectedSession(tenantId: string | null, error: string) {
  return {
    id: tenantId ?? null,
    status: "disconnected",
    qr_data: null,
    phone_number: null,
    last_connected_at: null,
    error,
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

export async function GET(req: Request) {
  const rid = Math.random().toString(16).slice(2);
  console.log(`👉 [API WA SESSION][GET][${rid}] hit`);

  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("t") || searchParams.get("tenantId");

    console.log(`👤 [${rid}] tenantId:`, tenantId);
    console.log(`🤖 [${rid}] WA_BOT_URL:`, WA_BOT_URL);

    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "Falta tenantId" }, { status: 400 });
    }

    const targetUrl = `${WA_BOT_URL}/sessions/${encodeURIComponent(tenantId)}`;

    let out: { res: Response; raw: string };
    try {
      out = await fetchTextWithTimeout(
        targetUrl,
        { headers: { "Content-Type": "application/json" } },
        5000
      );
    } catch (e: any) {
      console.error(`❌ [${rid}] bot unreachable:`, e?.message || e);
      return NextResponse.json({
        ok: true,
        session: disconnectedSession(tenantId, "Bot server unreachable"),
        _debug: { rid, where: "GET.fetch", WA_BOT_URL, targetUrl },
      });
    }

    const contentType = out.res.headers.get("content-type") || "";
    const status = out.res.status;

    if (!contentType.includes("application/json")) {
      console.error(
        `🔥 [${rid}] non-JSON from bot (status=${status}, ct=${contentType}). preview=${out.raw.slice(0, 160)}`
      );
      return NextResponse.json({
        ok: true,
        session: disconnectedSession(tenantId, "Bot server error (non-JSON)"),
        _debug: { rid, where: "GET.nonJSON", status, contentType, preview: out.raw.slice(0, 160) },
      });
    }

    const data = safeJsonParse(out.raw);
    if (!data) {
      console.error(
        `🔥 [${rid}] invalid JSON from bot (status=${status}). preview=${out.raw.slice(0, 160)}`
      );
      return NextResponse.json({
        ok: true,
        session: disconnectedSession(tenantId, "Bot server invalid JSON"),
        _debug: { rid, where: "GET.badJSON", status, preview: out.raw.slice(0, 160) },
      });
    }

    const s = data.session || data || {};
    return NextResponse.json({
      ok: true,
      session: {
        id: tenantId,
        status: s.status || "disconnected",
        qr_data: s.qr_data || s.qr || null,
        phone_number: s.phone_number || null,
        last_connected_at: s.last_connected_at || null,
      },
      _debug: { rid, where: "GET.ok", status },
    });
  } catch (e: any) {
    console.error(`💥 [API WA SESSION][GET][${rid}] crash:`, e);
    // ✅ NO 500: para que el UI no reviente
    return NextResponse.json({
      ok: true,
      session: disconnectedSession(null, "Internal error (GET)"),
      _debug: { rid, where: "GET.catch", message: e?.message || String(e) },
    });
  }
}

export async function POST(req: Request) {
  const rid = Math.random().toString(16).slice(2);
  console.log(`👉 [API WA SESSION][POST][${rid}] hit`);

  // ✅ SIEMPRE devolvemos 200 con JSON, aunque algo truene.
  try {
    const body = await req.json().catch(() => null);

    const action = body?.action;
    const tenantId = body?.tenantId || body?.t || body?.id;

    console.log(`👤 [${rid}] tenantId:`, tenantId);
    console.log(`🎬 [${rid}] action:`, action);
    console.log(`🤖 [${rid}] WA_BOT_URL:`, WA_BOT_URL);

    if (!tenantId || !action) {
      return NextResponse.json({
        ok: true,
        session: disconnectedSession(tenantId ?? null, "Datos incompletos (tenantId/action)"),
        _debug: { rid, where: "POST.validate", got: { tenantId, action } },
      });
    }

    const endpoint =
      action === "disconnect"
        ? `${WA_BOT_URL}/sessions/${encodeURIComponent(tenantId)}/disconnect`
        : `${WA_BOT_URL}/sessions/${encodeURIComponent(tenantId)}/connect`;

    let out: { res: Response; raw: string };
    try {
      out = await fetchTextWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        8000
      );
    } catch (e: any) {
      console.error(`❌ [${rid}] bot unreachable:`, e?.message || e);
      return NextResponse.json({
        ok: true,
        session: disconnectedSession(tenantId, "Bot server unreachable"),
        _debug: { rid, where: "POST.fetch", endpoint },
      });
    }

    const contentType = out.res.headers.get("content-type") || "";
    const status = out.res.status;

    // ✅ No convertimos no-JSON en 500
    if (!contentType.includes("application/json")) {
      console.error(
        `🔥 [${rid}] non-JSON from bot (status=${status}, ct=${contentType}). preview=${out.raw.slice(0, 160)}`
      );
      return NextResponse.json({
        ok: true,
        session: disconnectedSession(tenantId, "Bot server error (non-JSON)"),
        _debug: { rid, where: "POST.nonJSON", status, contentType, preview: out.raw.slice(0, 160) },
      });
    }

    const data = safeJsonParse(out.raw);
    if (!data) {
      console.error(
        `🔥 [${rid}] invalid JSON from bot (status=${status}). preview=${out.raw.slice(0, 160)}`
      );
      return NextResponse.json({
        ok: true,
        session: disconnectedSession(tenantId, "Bot server invalid JSON"),
        _debug: { rid, where: "POST.badJSON", status, preview: out.raw.slice(0, 160) },
      });
    }

    const s = data.session || data || {};
    return NextResponse.json({
      ok: true,
      session: {
        id: tenantId,
        status: s.status || (action === "disconnect" ? "disconnected" : "connecting"),
        qr_data: s.qr_data || s.qr || null,
        phone_number: s.phone_number || null,
        last_connected_at: s.last_connected_at || null,
      },
      _debug: { rid, where: "POST.ok", status },
    });
  } catch (e: any) {
    console.error(`💥 [API WA SESSION][POST][${rid}] crash:`, e);
    return NextResponse.json({
      ok: true,
      session: disconnectedSession(null, "Internal error (POST)"),
      _debug: { rid, where: "POST.catch", message: e?.message || String(e) },
    });
  }
}
