// src/app/lib/dashboard-summary.ts
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export type DashboardSummary = {
  totalBookings: number;
  totalCustomers: number;
  totalMessages: number;
  totalTemplates: number;
};

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const cookieStore = await cookies();
  const activeTenant = cookieStore.get("pyme.active_tenant")?.value || null;

  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          cookieStore.set({ name, value: "", ...options });
        },
      },
    }
  );

  // Si no hay tenant activo, caemos al primero (igual que en /api/whoami)
  let tenantId = activeTenant;
  if (!tenantId) {
    const { data: tenant } = await sb
      .from("tenants")
      .select("id")
      .eq("status", "active")
      .limit(1)
      .single();
    tenantId = tenant?.id ?? null;
  }

  if (!tenantId) {
    // No hay tenant: devolvemos todo en 0 para no romper el dashboard
    return {
      totalBookings: 0,
      totalCustomers: 0,
      totalMessages: 0,
      totalTemplates: 0,
    };
  }

  const [bookingsRes, contactsRes, messagesRes, templatesRes] =
    await Promise.all([
      sb.from("bookings").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
      sb.from("whatsapp_contacts").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
      sb.from("whatsapp_messages").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
      sb
        .from("message_templates")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("active", true),
    ]);

  return {
    totalBookings: bookingsRes.count ?? 0,
    totalCustomers: contactsRes.count ?? 0,
    totalMessages: messagesRes.count ?? 0,
    totalTemplates: templatesRes.count ?? 0,
  };
}
