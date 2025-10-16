// src/server/intents.ts
import { createClient } from "@supabase/supabase-js";

export type Intent = "book" | "cancel" | "reschedule" | "confirm" | "unknown";

export async function detectIntentBasic(text: string, tenantId?: string): Promise<Intent> {
  const clean = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await sb
    .from("intent_keywords")
    .select("intent, term")
    .or(`tenant_id.eq.${tenantId ?? "null"},tenant_id.is.null`);

  if (error) {
    console.error("[detectIntent] error:", error);
    return "unknown";
  }

  for (const row of data ?? []) {
    const term = row.term.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
    if (clean.includes(term)) return row.intent as Intent;
  }

  return "unknown";
}
