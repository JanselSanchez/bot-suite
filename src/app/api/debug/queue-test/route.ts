// src/app/api/debug/queue-test/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Ya no usamos Redis/Queue.
  // Este endpoint queda solo como referencia o health check simple.

  return NextResponse.json({
    ok: true,
    message: "El sistema de colas (Redis) ha sido eliminado.",
    status: "disabled",
    note: "El bot ahora funciona mediante llamadas HTTP directas (sin workers)."
  });
}