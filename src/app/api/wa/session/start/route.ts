// src/app/api/wa/session/start/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));

    // 1) tenant enviado explícito en el body (por si en el futuro lo usas)
    // 2) tenant activo guardado en cookie
    // 3) DEFAULT (solo como fallback)
    const cookieStore = await cookies();
    const cookieTenant = cookieStore.get("pyme.active_tenant")?.value;

    const tenantId: string =
      body?.tenantId ||
      cookieTenant ||
      process.env.WA_DEFAULT_TENANT_ID ||
      "creativadominicana";

    if (!tenantId || typeof tenantId !== "string") {
      return NextResponse.json(
        { ok: false, error: "INVALID_TENANT_ID" },
        { status: 400 },
      );
    }

    const baseUrl = process.env.WA_SERVER_URL;
    if (!baseUrl) {
      return NextResponse.json(
        { ok: false, error: "WA_SERVER_URL_NOT_SET" },
        { status: 500 },
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    let resp: Response;

    try {
      // 🔴 Aquí tu WA server debe crear/iniciar la sesión Baileys para ese tenantId
      resp = await fetch(`${baseUrl}/session/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId }),
        signal: controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timeout);
      console.error("[api/wa/session/start] fetch error:", err);
      const isAbortError = err?.name === "AbortError";

      return NextResponse.json(
        {
          ok: false,
          error: isAbortError ? "wa_server_timeout" : "wa_server_unreachable",
          details: String(err?.message || err),
        },
        { status: 502 },
      );
    } finally {
      clearTimeout(timeout);
    }

    let data: any = null;
    try {
      data = await resp.json();
    } catch {
      data = { ok: resp.ok, status: resp.status, raw: await resp.text() };
    }

    return NextResponse.json(data, { status: resp.status });
  } catch (err: any) {
    console.error("[api/wa/session/start] error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "internal_error",
        details: String(err?.message || err),
      },
      { status: 500 },
    );
  }
}
