"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import BusinessHoursEditor from "@/componentes/Availability/BusinessHoursEditor";
import ExceptionsTable from "@/componentes/Availability/ExceptionsTable";
import ResourceCalendar from "@/componentes/Calendar/ResourceCalendar";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function AvailabilityAdminPage() {
  const [tenantId, setTenantId] = useState<string>("");
  const [resourceId, setResourceId] = useState<string | "ALL">("ALL");
  const [resources, setResources] = useState<any[]>([]);

  // 1) tenantId del usuario (primer tenant)
  useEffect(() => {
    (async () => {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const { data: tu } = await sb
        .from("tenant_users")
        .select("tenant_id")
        .eq("user_id", user.id)
        .order("role", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (tu?.tenant_id) setTenantId(tu.tenant_id);
    })();
  }, []);

  // 2) cargar recursos del tenant
  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      const { data } = await sb
        .from("resources")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .order("name");
      setResources(data || []);
    })();
  }, [tenantId]);

  const currentResourceId = useMemo(
    () => (resourceId === "ALL" ? null : resourceId),
    [resourceId]
  );

  if (!tenantId) return <div className="p-6">Cargando…</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Disponibilidad</h1>
        <div className="flex gap-2 items-center">
          <label>Recurso:</label>
          <select
            className="border rounded px-2 py-1"
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value as any)}
          >
            <option value="ALL">General (sede)</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <BusinessHoursEditor tenantId={tenantId} resourceId={currentResourceId} />
      <ExceptionsTable tenantId={tenantId} resourceId={currentResourceId} />

      {/* Calendario (solo si hay recurso seleccionado) */}
      {currentResourceId && (
        <>
          <h2 className="font-medium">
            Calendario (día) — arrastra para reprogramar
          </h2>
          <ResourceCalendar
            tenantId={tenantId}
            resourceId={currentResourceId as string}
          />
        </>
      )}
    </div>
  );
}
