// src/app/dashboard/bookings/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import RescheduleDialog from "./RescheduleDialog";
import { useActiveTenant } from "@/app/providers/active-tenant";

type BookingRow = {
  id: string;
  tenant_id: string;
  service_id: string | null;
  resource_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  staff_name: string | null;
  starts_at: string;
  status: string | null;
  created_at?: string;
};

function useDebounceKey(obj: unknown, ms = 300) {
  const [key, setKey] = useState(() => JSON.stringify(obj));
  useEffect(() => {
    const t = setTimeout(() => setKey(JSON.stringify(obj)), ms);
    return () => clearTimeout(t);
  }, [obj, ms]);
  return key;
}

export default function AdminBookingsPage() {
  const { tenantId, loading: loadingTenant } = useActiveTenant();

  const [q, setQ] = useState("");
  const [date, setDate] = useState<string>("");
  const [scope, setScope] = useState<"all" | "today" | "upcoming" | "past">("all");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  const [rows, setRows] = useState<BookingRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [softError, setSoftError] = useState<string | null>(null);

  const [selected, setSelected] = useState<null | {
    id: string;
    tenant_id: string;
    service_id: string | null;
    resource_id: string | null;
    starts_at: string;
  }>(null);

  const fetchKey = useDebounceKey({ q, date, scope, page, tenantId }, 300);
  const abortRef = useRef<AbortController | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => setPage(1), [tenantId]);

  useEffect(() => {
    if (loadingTenant || !tenantId) return;

    // si hay una request viva, la cancelamos
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const myReqId = ++reqIdRef.current;
    setLoading(true);
    setSoftError(null);

    (async () => {
      const p = new URLSearchParams({
        tenantId,
        scope,
        page: String(page),
        pageSize: String(pageSize),
      });
      if (q) p.set("q", q);
      if (date) p.set("date", date);

      try {
        const r = await fetch(`/api/admin/bookings/search?${p.toString()}`, {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });

        if (myReqId !== reqIdRef.current) return; // llegó una respuesta vieja

        if (!r.ok) {
          // mantenemos los últimos datos buenos
          setSoftError("No se pudo actualizar. Mostrando últimos datos.");
          return;
        }

        const j = await r.json();
        if (j?.ok) {
          setRows(j.data || []);
          setTotal(j.total || 0);
          setSoftError(null);
        } else {
          setSoftError("Respuesta inválida del servidor.");
        }
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          setSoftError("Error de red. Mostrando últimos datos.");
        }
      } finally {
        if (myReqId === reqIdRef.current) setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey, loadingTenant, pageSize]);

  const title = useMemo(() => "Citas", []);
  const clearFilters = () => {
    setQ("");
    setDate("");
    setScope("all");
    setPage(1);
  };

  if (loadingTenant) return null;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">
            Busca por <strong>nombre</strong> o <strong>teléfono</strong>, o filtra por <strong>fecha</strong>.
          </p>
          <div className="mt-2 flex items-center gap-2">
            {tenantId ? (
              <span className="text-xs px-2 py-1 rounded-full border bg-gray-50">
                Tenant activo: {tenantId.slice(0, 8)}…
              </span>
            ) : (
              <span className="text-xs text-red-600">Selecciona un negocio en el topbar.</span>
            )}
            {softError && (
              <span className="text-xs px-2 py-1 rounded-full border border-amber-300 bg-amber-50 text-amber-700">
                {softError}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          className="border rounded-lg px-3 py-2 w-[320px]"
          placeholder="Buscar (nombre o teléfono)"
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
        />
        <input
          type="date"
          className="border rounded-lg px-3 py-2"
          value={date}
          onChange={(e) => {
            setPage(1);
            setDate(e.target.value);
          }}
        />
        <div className="flex gap-2">
          {(["all","today","upcoming","past"] as const).map(s => (
            <button
              key={s}
              onClick={() => { setScope(s); setDate(""); setPage(1); }}
              className={`px-3 py-2 rounded-lg border ${scope === s ? "bg-gray-100" : ""}`}
            >
              {s === "all" ? "Todo" : s === "today" ? "Hoy" : s === "upcoming" ? "Próximas" : "Pasadas"}
            </button>
          ))}
        </div>
        <button onClick={clearFilters} className="px-3 py-2 rounded-lg border">
          Limpiar
        </button>
      </div>

      {/* Tabla */}
      <div className="rounded-2xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left p-3">Fecha</th>
              <th className="text-left p-3">Hora</th>
              <th className="text-left p-3">Cliente</th>
              <th className="text-left p-3">Teléfono</th>
              <th className="text-left p-3">Estado</th>
              <th className="text-right p-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr><td className="p-4" colSpan={6}>Cargando…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="p-6 text-center text-gray-500" colSpan={6}>Sin resultados</td></tr>
            ) : (
              rows.map((b) => {
                const d = new Date(b.starts_at);
                const day = d.toLocaleDateString("es-DO", { year: "numeric", month: "2-digit", day: "2-digit" });
                const hour = d.toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" });
                return (
                  <tr key={b.id} className="border-t">
                    <td className="p-3">{day}</td>
                    <td className="p-3">{hour}</td>
                    <td className="p-3">{b.customer_name ?? "Cliente"}</td>
                    <td className="p-3">{b.customer_phone ?? "-"}</td>
                    <td className="p-3 capitalize">{b.status?.replace("_", " ") ?? "-"}</td>
                    <td className="p-3">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() =>
                            setSelected({
                              id: b.id,
                              tenant_id: b.tenant_id,
                              service_id: b.service_id,
                              resource_id: b.resource_id,
                              starts_at: b.starts_at,
                            })
                          }
                          className="px-2 py-1 rounded-lg border hover:bg-gray-50"
                        >
                          Reprogramar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      {total > pageSize && (
        <div className="flex items-center justify-end gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-2 rounded-lg border disabled:opacity-50"
          >
            Anterior
          </button>
          <span className="text-sm">Página {page}</span>
          <button
            disabled={rows.length < pageSize}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-2 rounded-lg border disabled:opacity-50"
          >
            Siguiente
          </button>
        </div>
      )}

      {/* Diálogo de reprogramación */}
      {selected && (
        <RescheduleDialog
          open={!!selected}
          onOpenChange={(v) => { if (!v) setSelected(null); }}
          booking={selected}
        />
      )}
    </div>
  );
}
