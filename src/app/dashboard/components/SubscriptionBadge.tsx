// app/(dashboard)/components/SubscriptionBadge.tsx
"use client";
import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

export default function SubscriptionBadge({ tenantId }: { tenantId: string }) {
  const [row, setRow] = useState<any | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await sb
        .from("v_tenant_subscription_status")
        .select("status, days_left, is_blocked")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      setRow(data || null);
    })();
  }, [tenantId]);

  if (!row) return null;

  if (row.is_blocked) {
    return (
      <div className="inline-flex items-center gap-2 rounded-full bg-red-100 text-red-700 px-3 py-1 text-sm">
        <span>🔒 Suscripción bloqueada</span>
        <a href="/billing" className="underline">Pagar ahora</a>
      </div>
    );
  }

  if (row.days_left <= 7) {
    return (
      <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 text-amber-800 px-3 py-1 text-sm">
        <span>⏳ Tu plan vence en {row.days_left} día{row.days_left === 1 ? "" : "s"}</span>
        <a href="/billing" className="underline">Renovar</a>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 text-emerald-800 px-3 py-1 text-sm">
      ✅ Suscripción activa
    </div>
  );
}
