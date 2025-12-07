// src/app/api/admin/test-whatsapp/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Como eliminamos Redis, ya no podemos encolar mensajes de prueba.
  // Esta ruta ahora sirve para verificar que la API responde.

  const waServerUrl = process.env.WA_SERVER_URL || "http://localhost:4001";
  
  let botStatus = "unknown";
  try {
    // Intentamos hacer un ping al bot local para ver si está vivo
    const res = await fetch(`${waServerUrl}/health`);
    const data = await res.json();
    botStatus = data.ok ? "online" : "offline";
  } catch (error) {
    botStatus = "unreachable (bot server not running?)";
  }

  return NextResponse.json({
    ok: true,
    message: "El sistema de colas (Redis) ha sido eliminado. El bot funciona en modo directo.",
    bot_server_status: botStatus,
    note: "Para probar el envío real, crea una cita o interactúa con el bot directamente."
  });
}