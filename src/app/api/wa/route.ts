// src/app/api/wa/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ServerStatus = {
  ok: boolean;
  status: "online" | "offline";
  error?: string | null;
  details?: string | null;
  checkedUrl?: string | null;
};

function normalizeBaseUrl(input?: string | null) {
  const raw = (input || "").trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, ""); // quita / al final
}

async function safeReadJson(resp: Response) {
  const ct = resp.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return null;
  try {
    return await resp.json();
  } catch {
    return null;
  }
}

export async function GET() {
  // ✅ Este log debe aparecer SIEMPRE que la ruta correcta esté corriendo
  console.log("👉 [api/wa] health check");

  try {
    const baseUrl =
      normalizeBaseUrl(process.env.WA_SERVER_URL) ||
      normalizeBaseUrl(process.env.NEXT_PUBLIC_WA_SERVER_URL);

    if (!baseUrl) {
      const body: ServerStatus = {
        ok: false,
        status: "offline",
        error: "WA_SERVER_URL_NOT_SET",
        details: "Configura WA_SERVER_URL (o NEXT_PUBLIC_WA_SERVER_URL) en Render/.env",
        checkedUrl: null,
      };
      return NextResponse.json(body, { status: 200 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const resp = await fetch(`${baseUrl}/health`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      });

      const data = await safeReadJson(resp);

      const isOk = resp.ok && (data?.ok === true || data?.status === "ok");

      const body: ServerStatus = {
        ok: isOk,
        status: isOk ? "online" : "offline",
        error: isOk ? null : "WA_SERVER_HEALTH_ERROR",
        details: isOk
          ? null
          : `HTTP ${resp.status}${data ? ` | body.ok=${String(data?.ok)}` : " | non-json body"}`,
        checkedUrl: `${baseUrl}/health`,
      };

      return NextResponse.json(body, { status: 200 });
    } catch (err: any) {
      const body: ServerStatus = {
        ok: false,
        status: "offline",
        error: "WA_SERVER_UNREACHABLE",
        details: String(err?.message || err),
        checkedUrl: `${baseUrl}/health`,
      };
      console.error("[api/wa] unreachable:", err);
      return NextResponse.json(body, { status: 200 });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err: any) {
    // ✅ blindaje final: jamás 500 aquí
    console.error("[api/wa] crash:", err);
    const body: ServerStatus = {
      ok: false,
      status: "offline",
      error: "WA_ROUTE_CRASH",
      details: String(err?.message || err),
      checkedUrl: null,
    };
    return NextResponse.json(body, { status: 200 });
  }
}
