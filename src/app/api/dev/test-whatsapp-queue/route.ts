// src/app/api/admin/test-whatsapp/route.ts
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

  // ⚠️ CAMBIA ESTE NÚMERO POR TU WHATSAPP VERIFICADO EN TWILIO
  const payload: WhatsappJobPayload = {
    tenantId: "debug-tenant",
    to: "whatsapp:+1829XXXXXXXX", // ← pon tu número real aquí
    body: "Mensaje de prueba desde /api/admin/test-whatsapp",
    // Si quisieras probar plantilla interna:
    // templateKey: "cita_confirmada",
    // variables: { nombre: "Cliente Demo", fecha: "hoy", negocio: "PymeBOT Demo" },
  };

  const job = await whatsappQueue.add("test_whatsapp", payload);

  return NextResponse.json({
    ok: true,
    message: "Job encolado en la cola 'whatsapp'",
    jobId: job.id,
    payload,
  });
}
