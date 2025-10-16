// worker/utils/state.ts
import type { SupabaseClient } from "@supabase/supabase-js";

export async function getState(supabase: SupabaseClient, conversationId: string) {
  const { data, error } = await supabase
    .from("conversation_state")
    .select("conversation_id, tenant_id, stage")
    .eq("conversation_id", conversationId)
    .maybeSingle();

  if (error) {
    console.error("[state] get error:", error.message);
    return null;
  }
  return data;
}

export async function setStage(
  supabase: SupabaseClient,
  conversationId: string,
  stage: string
) {
  const { error } = await supabase
    .from("conversation_state")
    .update({ stage, updated_at: new Date().toISOString() })
    .eq("conversation_id", conversationId);

  if (error) console.error("[state] set error:", error.message);
}
