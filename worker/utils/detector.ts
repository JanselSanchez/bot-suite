// worker/intents/detector.ts
import type IORedis from "ioredis";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalize } from "../utils/normalizer";
import { getKeywords } from "../utils/keywordsCache";
import { scoreIntent, pickIntent } from "../utils/scoring";

export async function detectIntent(params: {
  tenantId: string;
  text: string;
  redis: IORedis;
  supabase: SupabaseClient;
}) {
  const { tenantId, text, redis, supabase } = params;
  const normalized = normalize(text);
  const keywords = await getKeywords(tenantId, redis, supabase);
  const { byIntent, matches } = scoreIntent(normalized, keywords);
  const { intent, score } = pickIntent(byIntent);

  return { intent, score, normalized, matches };
}
