// src/app/api/debug/queue-test/route.ts
import { NextResponse } from "next/server";
import {
  whatsappQueue,
  type WhatsappJobPayload,
} from "@/server/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!whatsappQueue) {
    return NextResponse.json(
      { ok: false, error: "Cola deshabilitada (no hay REDIS_URL)" },
      { status: 500 }
    );
  }

  // ⚠️ Cambia este número por tu WhatsApp verificado en Twilio
  const payload: WhatsappJobPayload = {
    tenantId: "debug-tenant",
    to: "whatsapp:+18298844957", // ← pon aquí tu número real
    body: "hola desde la cola (debug)", // usamos body en vez de msg
    // templateKey: "cita_confirmada", // opcional si quisieras usar plantilla interna
    // variables: { nombre: "Cliente Demo", fecha: "hoy", negocio: "PymeBOT Demo" },
  };

  const job = await whatsappQueue.add("test_debug", payload);

  return NextResponse.json({
    ok: true,
    message: "Job encolado",
    jobId: job.id,
    payload,
  });
}
