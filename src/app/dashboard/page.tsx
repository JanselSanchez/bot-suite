// app/(dashboard)/page.tsx
import SubscriptionBadge from "./components/SubscriptionBadge";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// Ajusta si tu schema/roles difieren
type TenantUser = {
  tenant_id: string;
  role: "owner" | "admin" | "staff";
};

export default async function DashboardPage() {
  // Supabase en server con cookies del usuario
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
      },
    }
  );

  // 1) Usuario actual
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // redirige a login o muestra mensaje
    return (
      <div className="p-6">
        <p>Necesitas iniciar sesión.</p>
      </div>
    );
  }

  // 2) Buscar tenant del usuario (elige la lógica que uses)
  //    Aquí tomo el PRIMER tenant donde está (owner/admin/staff)
  const { data: tu } = await supabase
    .from("tenant_users")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .order("role", { ascending: true }) // opcional: prioriza owner/admin
    .limit(1)
    .maybeSingle<TenantUser>();

  const tenantId = tu?.tenant_id;

  if (!tenantId) {
    return (
      <div className="p-6 space-y-4">
        <p>No se encontró un tenant asignado a tu usuario.</p>
        <p>Por favor, crea o únete a un negocio para continuar.</p>
      </div>
    );
  }

  // 3) Render del dashboard con el badge
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Panel</h1>
        <SubscriptionBadge tenantId={tenantId} />
      </div>

      {/* ...resto de tu dashboard */}
      <div className="rounded border p-4">
        <p>Contenido del panel…</p>
      </div>
    </div>
  );
}
