// worker/enforcement.ts
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function ensureTenantActiveOrThrow(tenantId: string) {
  const { data, error } = await sb
    .from("v_tenants_blocked")
    .select("is_blocked, expires_at, status")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) throw error;

  if (data?.is_blocked) {
    const msg = `Tenant ${tenantId} bloqueado (status=${data.status}) hasta ${data.expires_at?.toString()}`;
    // Opcional: loggear en Sentry y marcar job como "skipped"
    throw new Error(msg);
  }
}
