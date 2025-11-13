// src/app/server/tenants.ts
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, // si tienes service key, úsala aquí
  { auth: { persistSession: false } }
);

export function normalizeE164(input: string): string {
  // admite "whatsapp:+1849..." o "+1849..." o "1849..."
  const s = input.replace(/^whatsapp:/i, '').trim();
  if (s.startsWith('+')) return s;
  if (/^\d+$/.test(s)) return `+${s}`;
  return s; // último recurso
}

export async function findTenantByWaNumber(waToHeader: string) {
  const e164 = normalizeE164(waToHeader);
  const { data } = await sb
    .from('tenants')
    .select('id,name,is_active,due_on,grace_days,wa_number')
    .eq('wa_number', e164)
    .maybeSingle();
  return data ?? null;
}

export function isBlockedTenant(tenant: {
  is_active: boolean | null;
  due_on: string | null;
  grace_days: number | null;
}) {
  const active = tenant?.is_active ?? true;
  if (!active) return true;

  if (!tenant?.due_on) return false;
  const due = new Date(tenant.due_on).getTime();
  const graceMs = ((tenant?.grace_days ?? 0) * 24 * 60 * 60 * 1000);
  return Date.now() > (due + graceMs);
}
