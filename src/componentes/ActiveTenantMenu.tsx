"use client";
import { useEffect, useState } from "react";
import { useActiveTenant } from "@/app/providers/active-tenant";

type T = { id: string; name: string };

export default function ActiveTenantMenu() {
  const { tenantId, setTenantId, loading } = useActiveTenant();
  const [items, setItems] = useState<T[]>([]);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/admin/tenants/list", { credentials: "include", cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (j?.ok) setItems(j.tenants || []);
    })();
  }, []);

  if (loading) return <span className="text-sm text-gray-500">Cargando…</span>;
  if (!items.length) return <span className="text-sm text-gray-500">Sin negocios</span>;

  return (
    <select
      className="border rounded-lg px-3 py-2"
      value={tenantId || ""}
      onChange={(e) => setTenantId(e.target.value)}
    >
      {items.map(t => (
        <option key={t.id} value={t.id}>{t.name || t.id.slice(0,8)}</option>
      ))}
    </select>
  );
}
