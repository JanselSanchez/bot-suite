// src/app/api/health/route.ts
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

// Forzamos que esta ruta sea dinámica (no cacheada)
export const dynamic = "force-dynamic";

export async function GET() {
  // 1. Verificamos variables de entorno
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
  };

  // 2. Chequeo de conexión a Supabase usando tu cliente existente
  let supabaseOk = false;
  let errorMsg = null;

  try {
    const { error } = await supabaseAdmin
      .from("tenants")
      .select("id")
      .limit(1);
    
    if (!error) {
      supabaseOk = true;
    } else {
      errorMsg = error.message;
    }
  } catch (e: any) {
    console.error("Health check error:", e);
    errorMsg = e.toString();
  }

  // 3. Estado de los servicios (Redis desactivado)
  const services = {
    supabase: { ok: supabaseOk, error: errorMsg },
    redis: { status: "disabled" },
    worker: { heartbeat: false },
  };

  // Usamos Response.json nativo para evitar líos de imports
  return Response.json({
    ok: supabaseOk,
    env,
    services,
    message: "Bot Suite Running (Monolith Mode)"
  }, {
    status: supabaseOk ? 200 : 503
  });
}