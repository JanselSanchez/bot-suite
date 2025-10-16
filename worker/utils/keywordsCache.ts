// worker/utils/keywordsCache.ts
import type IORedis from "ioredis";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Keyword = {
  frase: string;
  intent: string;
  peso: number;
  es_error: boolean;
};

export async function getKeywords(
  tenantId: string,
  redis: IORedis,
  supabase: SupabaseClient
): Promise<Keyword[]> {
  const key = `kw:${tenantId}`;
  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as Keyword[];
  } catch {}

  const { data, error } = await supabase
    .from("intent_keywords")
    .select("frase,intent,peso,es_error")
    .eq("tenant_id", tenantId)
    .limit(500);

  if (error) {
    console.error("[kw] supabase error:", error.message);
    return [];
  }

  try {
    await redis.set(key, JSON.stringify(data || []), "EX", 600); // 10 min
  } catch {}

  return (data as Keyword[]) || [];
}
