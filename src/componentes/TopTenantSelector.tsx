"use client";
import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { ChevronDown } from "lucide-react";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const KEY_SELECTED_TENANT = "pb.selectedTenantId";

export default function TopTenantSelector() {
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [open, setOpen] = useState(false);

  // Carga inicial
  useEffect(() => {
    (async () => {
      const { data: ts } = await sb
        .from("tenants")
        .select("id,name")
        .order("created_at", { ascending: false });
      if (ts?.length) setTenants(ts);

      let init = "";
      try {
        const fromStorage =
          typeof window !== "undefined"
            ? localStorage.getItem(KEY_SELECTED_TENANT)
            : null;
        if (fromStorage && ts?.some((t) => t.id === fromStorage)) init = fromStorage;
        else init = ts?.[0]?.id || "";
      } catch {}
      setSelected(init);
    })();
  }, []);

  function handleSelect(id: string) {
    setSelected(id);
    localStorage.setItem(KEY_SELECTED_TENANT, id);
    setOpen(false);
    // refresca dashboard automáticamente
    window.location.reload();
  }

  const selectedTenant = tenants.find((t) => t.id === selected);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition"
      >
        <span>{selectedTenant ? selectedTenant.name : "Seleccionar negocio"}</span>
        <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-gray-200 bg-white shadow-xl backdrop-blur-xl overflow-hidden z-50">
          {tenants.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-500">Sin negocios</div>
          ) : (
            tenants.map((t) => (
              <button
                key={t.id}
                onClick={() => handleSelect(t.id)}
                className={`block w-full text-left px-4 py-2.5 text-sm transition ${
                  selected === t.id
                    ? "bg-violet-50 text-violet-700"
                    : "hover:bg-gray-50 text-gray-700"
                }`}
              >
                {t.name}
              </button>
            ))
          )}
          <div className="border-t border-gray-100" />
          <a
            href="/dashboard/tenants/new"
            className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            + Nuevo negocio
          </a>
        </div>
      )}
    </div>
  );
}
