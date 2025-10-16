import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export function renderTemplate(body: string, vars: Record<string, string>) {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

const DEFAULTS: Record<string, string> = {
  "booking_confirmed":
    "✅ {{customer_name}}, tu cita quedó para {{date}} a las {{time}} con {{resource_name}}. Si necesitas cambiarla, responde a este mensaje.",
  "booking_rescheduled":
    "🔁 {{customer_name}}, reprogramamos tu cita para {{date}} a las {{time}} con {{resource_name}}.",
  "booking_cancelled":
    "🗓️ {{customer_name}}, tu cita con {{resource_name}} fue cancelada. Si deseas agendar otra, responde este mensaje.",
  "reminder":
    "⏰ Recordatorio: {{customer_name}}, te esperamos el {{date}} a las {{time}} con {{resource_name}}. Responde ‘REAGENDAR’ si necesitas moverla.",
  "payment_required":
    "⚠️ Servicio temporalmente bloqueado por suscripción vencida. Paga aquí para reactivar inmediatamente: {{payment_link}}",
};

export async function getTemplateOrDefault(
  tenantId: string,
  channel: "whatsapp" | "sms" | "email",
  event:
    | "booking_confirmed"
    | "booking_rescheduled"
    | "booking_cancelled"
    | "reminder"
    | "payment_required"
): Promise<string> {
  const { data, error } = await sb
    .from("message_templates")
    .select("body")
    .eq("tenant_id", tenantId)
    .eq("channel", channel)
    .eq("event", event)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    // loggear si quieres
    return DEFAULTS[event] || "";
  }
  return data?.body || DEFAULTS[event] || "";
}
