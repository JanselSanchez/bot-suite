// src/app/api/health/route.ts
import { NextResponse } from "next/server";
import Redis from "ioredis";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET() {
  // --------- ENV FLAGS ----------
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    REDIS_URL: !!process.env.REDIS_URL,
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
  };

  // --------- CHEQUEO SUPABASE ----------
  let supabaseOk = false;
  try {
    const { error } = await supabaseAdmin
      .from("tenants")
      .select("id")
      .limit(1);
    supabaseOk = !error;
  } catch {
    supabaseOk = false;
  }

  // --------- CHEQUEO REDIS ----------
  let redisOk: boolean | undefined = undefined;

  if (process.env.REDIS_URL) {
    try {
      const redis = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
      });
      await redis.ping();
      redisOk = true;
      redis.disconnect();
    } catch {
      redisOk = false; // lo marcamos como error, pero no rompemos el endpoint
    }
  }

  const services = {
    supabase: { ok: supabaseOk },
    redis: { ok: redisOk },
    worker: { heartbeat: false },
    twilio: { envs: false },
  };

  const ok = supabaseOk && (redisOk !== false);

  return NextResponse.json({
    ok,
    env,
    services,
  });
}
