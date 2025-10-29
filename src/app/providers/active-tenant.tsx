"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Ctx = {
  tenantId: string;
  setTenantId: (id: string) => void;
  loading: boolean;
};

const ActiveTenantCtx = createContext<Ctx>({ tenantId: "", setTenantId: () => {}, loading: true });

export function ActiveTenantProvider({ children }: { children: ReactNode }) {
  const [tenantId, setTenantIdState] = useState("");
  const [loading, setLoading] = useState(true);

  // Carga inicial desde /api/admin/whoami
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/admin/whoami", { credentials: "include", cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j?.tenantId) setTenantIdState(j.tenantId);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Cambiar tenant => POST a /tenants/activate y refresca
  const setTenantId = (id: string) => {
    setTenantIdState(id);
    fetch("/api/admin/tenants/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ tenantId: id }),
    }).catch(() => {});
  };

  return (
    <ActiveTenantCtx.Provider value={{ tenantId, setTenantId, loading }}>
      {children}
    </ActiveTenantCtx.Provider>
  );
}

export function useActiveTenant() {
  return useContext(ActiveTenantCtx);
}
