// src/app/server/templates.ts
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

type GetTemplateOptions = {
  tenantId: string;
  event: string;     // ej: "pricing_pitch"
  channel: string;   // ej: "whatsapp"
  defaultBody: string;
};

export async function getTemplateOrDefault(
  opts: GetTemplateOptions
): Promise<string> {
  const { tenantId, event, channel, defaultBody } = opts;

  const { data, error } = await supabaseAdmin
    .from("message_templates")
    .select("body")
    .eq("tenant_id", tenantId)
    .eq("event", event)
    .eq("channel", channel)
    .eq("active", true)
    .maybeSingle();

  if (error || !data || !data.body) {
    return defaultBody;
  }

  return data.body;
}
