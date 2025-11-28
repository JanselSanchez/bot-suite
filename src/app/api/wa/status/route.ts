// src/app/api/wa/status/route.ts
import { NextResponse } from "next/server";
import { ensureWaClient, getWaStatus } from "@/server/whatsapp/runtime";

export const runtime = "nodejs";

export async function GET() {
  try {
    // Arranca Baileys la primera vez que se llama
    await ensureWaClient();

    const status = getWaStatus();

    return NextResponse.json(
      {
        ok: true,
        online: status.ready,                 // true = conectado
        status: status.ready ? "online" : "waiting_qr",
        qr: status.qr,                        // si hay QR disponible
        updatedAt: status.lastUpdate,         // ISO string
      },
      { status: 200 },
    );
  } catch (err: any) {
    console.error("[api/wa/status] internal_error:", err);
    return NextResponse.json(
      {
        ok: false,
        online: false,
        status: "offline",
        error: "internal_error",
        details: String(err?.message || err),
      },
      { status: 500 },
    );
  }
}
