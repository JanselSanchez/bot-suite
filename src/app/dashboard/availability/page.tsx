"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import BusinessHoursEditor from "@/componentes/Availability/BusinessHoursEditor";
import ExceptionsTable from "@/componentes/Availability/ExceptionsTable";
import ResourceCalendar from "@/componentes/Calendar/ResourceCalendar";


const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function AvailabilityPage() {
  const [tenantId, setTenantId] = useState<string>("");
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data: tu } = await sb
        .from("tenant_users")
        .select("tenant_id")
        .eq("user_id", user.id)
        .order("role", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!tu?.tenant_id) { setLoading(false); return; }
      setTenantId(tu.tenant_id);

      let rid: string | null = null;

      const { data: res1 } = await sb
        .from("resources")
        .select("id")
        .eq("tenant_id", tu.tenant_id)
        .limit(1);
      rid = res1?.[0]?.id ?? null;

      if (!rid) {
        const { data: res2 } = await sb
          .from("staff")
          .select("id")
          .eq("tenant_id", tu.tenant_id)
          .limit(1);
        rid = res2?.[0]?.id ?? null;
      }

      setResourceId(rid);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="p-6 space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Disponibilidad</h1>
        <p className="text-sm text-gray-500">
          Define horarios por día, excepciones y visualiza el calendario.
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="text-xl font-medium">Horarios</h2>
        {tenantId ? (
          <BusinessHoursEditor tenantId={tenantId} resourceId={resourceId} />
        ) : (
          <div className="text-sm text-gray-500">
            {loading ? "Cargando..." : "No se pudo cargar el tenant."}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-medium">Excepciones</h2>
        {tenantId ? (
          <ExceptionsTable tenantId={tenantId} resourceId={resourceId} />
        ) : null}
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-medium">Calendario</h2>
        {tenantId && resourceId ? (
          <ResourceCalendar tenantId={tenantId} resourceId={resourceId} />
        ) : (
          <div className="text-sm text-gray-500">
            {loading
              ? "Cargando calendario…"
              : "Selecciona/crea un recurso para ver el calendario."}
          </div>
        )}
      </section>
    </div>
  );
}
