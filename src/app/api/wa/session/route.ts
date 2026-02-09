import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 1) Configuración de la URL del Bot
// Si no existe la variable en Render, asumimos localhost (evita crashes por undefined)
const WA_BOT_URL = (
  process.env.WA_SERVER_URL ||
  process.env.NEXT_PUBLIC_WA_SERVER_URL ||
  "http://localhost:4001"
).replace(/\/$/, ""); // Quitamos barra final si existe

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

export async function GET(req: Request) {
  console.log("👉 [API SESSION][GET] Iniciando petición...");

  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("t") || searchParams.get("tenantId");

    console.log(`👤 Tenant ID: ${tenantId}`);
    console.log(`🤖 Bot URL: ${WA_BOT_URL}`);

    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "Falta tenantId" }, { status: 400 });
    }

    const targetUrl = `${WA_BOT_URL}/sessions/${encodeURIComponent(tenantId)}`;

    // Timeout de 4 segundos (para que no se quede colgado eternamente)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    let res: Response;
    try {
      res = await fetch(targetUrl, {
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (fetchError: any) {
      console.error(
        `❌ [API SESSION][GET] No se pudo conectar al Bot Server: ${fetchError?.message || fetchError}`
      );
      // En vez de 500, devolvemos "disconnected" para que el UI no se rompa.
      return NextResponse.json({
        ok: true,
        session: disconnectedSession(tenantId, "Bot server unreachable"),
      });
    } finally {
      clearTimeout(timeoutId);
    }

    // Leemos SIEMPRE como texto primero para evitar "Unexpected end of JSON input"
    const raw = await res.text();
    const contentType = res.headers.get("content-type") || "";

    // Si no viene JSON, log y devolvemos disconnected (sin 500)
    if (!contentType.includes("application/json")) {
      console.error(
        `🔥 [API SESSION][GET] Bot devolvió no-JSON (status=${res.status}). Body preview: ${raw.slice(0, 120)}`
      );
      return NextResponse.json({
        ok: true,
        session: disconnectedSession(tenantId, "Bot server error (non-JSON)"),
      });
    }

    // JSON seguro (o null si estaba vacío/dañado)
    const data = safeJsonParse(raw);

    if (!data) {
      console.error(
        `🔥 [API SESSION][GET] JSON inválido o vacío (status=${res.status}). Body preview: ${raw.slice(0, 120)}`
      );
      return NextResponse.json({
        ok: true,
        session: disconnectedSession(tenantId, "Bot server invalid JSON"),
      });
    }

    // Manejo flexible de la estructura de respuesta
    const sessionData = data.session || data || {};

    return NextResponse.json({
      ok: true,
      session: {
        id: tenantId,
        status: sessionData.status || "disconnected",
        qr_data: sessionData.qr_data || sessionData.qr || null,
        // ✅ Alinear con tu UI (usa phone_number)
        phone_number: sessionData.phone_number || null,
        // ✅ Alinear con tu UI (usa last_connected_at)
        last_connected_at: sessionData.last_connected_at || null,
      },
    });
  } catch (error: any) {
    console.error("💥 [API SESSION][GET][CRASH]:", error);

    // Aquí sí mantenemos 500 porque fue crash REAL del handler,
    // pero igual devolvemos JSON.
    return NextResponse.json(
      { ok: false, error: "Error interno: " + (error?.message || String(error)) },
      { status: 500 }
    );
  }
}

// POST: Para conectar/desconectar
export async function POST(req: Request) {
  console.log("👉 [API SESSION][POST] Iniciando petición...");

  try {
    const body = await req.json().catch(() => null);
    const action = body?.action;
    const tenantId = body?.tenantId;
    const tId = tenantId || body?.t || body?.id;

    if (!tId || !action) {
      return NextResponse.json({ ok: false, error: "Datos incompletos" }, { status: 400 });
    }

    const endpoint =
      action === "disconnect"
        ? `${WA_BOT_URL}/sessions/${encodeURIComponent(tId)}/disconnect`
        : `${WA_BOT_URL}/sessions/${encodeURIComponent(tId)}/connect`;

    console.log(`🚀 [API SESSION][POST] Enviando ${action} a ${endpoint}`);

    // Timeout de 6 segundos (POST suele tardar un poco más)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (fetchError: any) {
      console.error(
        `❌ [API SESSION][POST] No se pudo conectar al Bot Server: ${fetchError?.message || fetchError}`
      );
      // No 500: devolvemos disconnected y el UI sigue vivo.
      return NextResponse.json({
        ok: true,
        session: disconnectedSession(tId, "Bot server unreachable"),
      });
    } finally {
      clearTimeout(timeoutId);
    }

    // Igual que en GET: leemos como texto primero.
    const raw = await res.text();
    const contentType = res.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      console.error(
        `🔥 [API SESSION][POST] Bot devolvió no-JSON (status=${res.status}). Body preview: ${raw.slice(0, 120)}`
      );
      // Antes tirabas 500; ahora asumimos disconnected para evitar caídas.
      return NextResponse.json({
        ok: true,
        session: disconnectedSession(tId, "Bot server error (non-JSON)"),
      });
    }

    const data = safeJsonParse(raw);

    if (!data) {
      console.error(
        `🔥 [API SESSION][POST] JSON inválido o vacío (status=${res.status}). Body preview: ${raw.slice(0, 120)}`
      );
      return NextResponse.json({
        ok: true,
        session: disconnectedSession(tId, "Bot server invalid JSON"),
      });
    }

    // Respuesta flexible: data.session o data directo
    const sessionData = data.session || data || {};

    return NextResponse.json({
      ok: true,
      session: {
        id: tId,
        status: sessionData.status || "disconnected",
        qr_data: sessionData.qr_data || sessionData.qr || null,
        phone_number: sessionData.phone_number || null,
        last_connected_at: sessionData.last_connected_at || null,
      },
    });
  } catch (error: any) {
    console.error("💥 [API SESSION][POST][CRASH]:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
