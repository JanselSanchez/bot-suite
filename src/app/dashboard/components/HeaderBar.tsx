"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import { Bell, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const KEY_SELECTED_TENANT = "pb.selectedTenantId";

type Tenant = { id: string; name: string };

export default function HeaderBar() {
  return (
    <div className="sticky top-0 z-30">
      <div className="mx-4 mt-4 mb-2 flex items-center justify-between rounded-2xl border border-black/5 bg-white/70 px-4 py-2 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-zinc-900/60">
        {/* IZQUIERDA: Selector dentro del nav */}
        <div className="flex min-w-0 items-center gap-3">
          {/* Si quieres mostrar un logo/nombre, ponlo aquí */}
          {/* <div className="hidden sm:block font-semibold">PymeBOT</div> */}
          <TenantSelectorInline />
        </div>

        {/* DERECHA: acciones rápidas */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded-full p-2 hover:bg-black/5 dark:hover:bg-white/10"
            aria-label="Notificaciones"
            title="Notificaciones"
          >
            <Bell size={18} />
          </button>
          <Link
            href="/(auth)/signout"
            className="rounded-full p-2 hover:bg-black/5 dark:hover:bg-white/10"
            aria-label="Salir"
            title="Salir"
          >
            <LogOut size={18} />
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Selector minimal que:
 * 1) Carga los tenants del usuario (via tenant_users → tenants)
 * 2) Lee/escribe pb.selectedTenantId en localStorage
 * 3) Llama router.refresh() para que page.tsx recalcule KPIs
 */
function TenantSelectorInline() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Tenant[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");

  const selected = useMemo(
    () => items.find((t) => t.id === selectedId),
    [items, selectedId]
  );

  useEffect(() => {
    (async () => {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { setLoading(false); return; }

      // Trae los tenants del usuario. Ajusta las columnas si tu relación tiene otros nombres.
      const { data: rows } = await sb
        .from("tenant_users")
        .select("tenant_id, tenants:tenant_id ( id, name )")
        .eq("user_id", user.id);

      const list: Tenant[] = (rows || [])
        .map((r: any) => r.tenants)
        .filter(Boolean)
        .map((t: any) => ({ id: t.id, name: t.name }));

      setItems(list);

      // Resolver selección inicial
      let current = "";
      try {
        const fromLS = localStorage.getItem(KEY_SELECTED_TENANT);
        if (fromLS) current = fromLS;
      } catch {}

      if (!current && list.length > 0) current = list[0].id;

      setSelectedId(current);
      setLoading(false);
    })();
  }, []);

  const onPick = (id: string) => {
    setSelectedId(id);
    try { localStorage.setItem(KEY_SELECTED_TENANT, id); } catch {}
    router.refresh(); // page.tsx leerá el nuevo tenant y actualizará KPIs/recientes
  };

  if (loading) {
    return (
      <div className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm opacity-70">
        <span className="h-2 w-2 animate-pulse rounded-full bg-violet-500" />
        <span>Cargando negocios…</span>
      </div>
    );
  }

  if (!items.length) {
    return (
      <Link
        href="/dashboard/tenants/new"
        className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10"
      >
        <span className="font-medium text-violet-700">Crear negocio</span>
      </Link>
    );
  }

  // Botón "pill" con <select> superpuesto (sólido, sin libs)
  return (
    <div className="relative">
      <button
        type="button"
        className="inline-flex max-w-[260px] items-center gap-2 truncate rounded-xl border px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10"
        title={selected?.name || "Seleccionar negocio"}
      >
        <span className="truncate font-medium">
          {selected?.name || "Seleccionar negocio"}
        </span>
        <svg
          className="h-4 w-4 opacity-60"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
        </svg>
      </button>

      {/* Select nativo encima para capturar el click y cambiar */}
      <select
        className="absolute inset-0 w-full cursor-pointer opacity-0"
        value={selectedId}
        onChange={(e) => onPick(e.target.value)}
        aria-label="Seleccionar negocio"
      >
        {items.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </div>
  );
}
