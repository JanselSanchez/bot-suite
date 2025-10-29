// src/app/dashboard/reschedule/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import RescheduleDialog from "../bookings/RescheduleDialog";

type Booking = {
  id: string;
  tenant_id: string;
  service_id: string | null;     // ← permitir null
  resource_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  staff_name: string | null;
  starts_at: string;
  status: string | null;
};

// Debounce para una CLAVE PRIMITIVA (string)
function useDebounceKey(val: string, ms = 350) {
  const [v, setV] = useState(val);
  useEffect(() => {
    const t = setTimeout(() => {
      if (val !== v) setV(val);
    }, ms);
    return () => clearTimeout(t);
  }, [val, ms, v]);
  return v;
}

export default function ReschedulePage() {
  const sp = useSearchParams();
  const directId = sp.get("id")?.trim() || null;

  const [tenants, setTenants] = useState<Array<{ id: string; name: string }>>(
    []
  );
  const [pendingTenant, setPendingTenant] = useState("");

  const [tenantId, setTenantId] = useState("");
  const [whoamiErr, setWhoamiErr] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  const [q, setQ] = useState("");
  const [date, setDate] = useState<string>(""); // YYYY-MM-DD
  const [scope, setScope] = useState<"all" | "today" | "upcoming" | "past">("all");
  const [rows, setRows] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);
  const [softError, setSoftError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const [selected, setSelected] = useState<null | {
    id: string;
    tenant_id: string;
    service_id: string | null;
    resource_id: string | null;
    starts_at: string;
  }>(null);

  // Cargar lista de tenants si aún no hay tenant activo
  useEffect(() => {
    if (tenantId) return;
    (async () => {
      try {
        const r = await fetch("/api/admin/tenants/list", {
          credentials: "include",
          cache: "no-store",
        });
        const j = await r.json();
        if (j?.ok)
          setTenants(
            (j.tenants || []).map((t: any) => ({
              id: t.id,
              name: t.name || t.id,
            }))
          );
      } catch {}
    })();
  }, [tenantId]);

  // 1) whoami
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/admin/whoami", {
          credentials: "include",
          cache: "no-store",
        });
        if (!r.ok) {
          setWhoamiErr(`${r.status}`);
          return;
        }
        const j = await r.json();
        if (j?.ok && j.tenantId) {
          setTenantId(j.tenantId);
          setWhoamiErr(null);
        } else {
          setWhoamiErr(j?.error || "NO_TENANT");
        }
      } catch (e: any) {
        setWhoamiErr(e?.message || "ERR");
      }
    })();
  }, []);

  // 2) abrir directo por id
  useEffect(() => {
    if (!directId || !tenantId) return;
    (async () => {
      try {
        const r = await fetch(`/api/admin/bookings/${directId}`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!r.ok) return;
        const j = await r.json();
        if (j?.data) {
          const b = j.data as Booking;
          setSelected({
            id: b.id,
            tenant_id: b.tenant_id,
            service_id: b.service_id,
            resource_id: b.resource_id,
            starts_at: b.starts_at,
          });
        }
      } catch {}
    })();
  }, [directId, tenantId]);

  // -------- FIX: clave estable + debounce + AbortController + last-good data --------
  const queryKey = `${tenantId}::${scope}::${page}::${q.trim()}::${date || ""}`;
  const debouncedKey = useDebounceKey(queryKey, 350);
  const abortRef = useRef<AbortController | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!tenantId) return;

    // cancelar request anterior
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
        pageSize: "20",
      });
      if (q.trim()) p.set("q", q.trim());
      if (date) p.set("date", date);

      try {
        const r = await fetch(`/api/admin/bookings/search?${p.toString()}`, {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });

        if (myReqId !== reqIdRef.current) return; // respuesta vieja

        if (!r.ok) {
          setSoftError("No se pudo actualizar. Mostrando últimos datos.");
          return; // NO vaciamos rows
        }

        const j = await r.json();
        if (j?.ok) {
          setRows(j.data || []);
          setTotal(j.total || 0);
          setSoftError(null);
        } else {
          setSoftError("Respuesta inválida del servidor.");
        }
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          setSoftError("Error de red. Mostrando últimos datos.");
        }
      } finally {
        if (myReqId === reqIdRef.current) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [debouncedKey, tenantId, scope, page, q, date]);
  // ----------------------------------------------------------------

  // helpers
  const title = useMemo(() => "Reprogramar", []);
  const clearFilters = () => {
    setQ("");
    setDate("");
    setScope("all");
    setPage(1);
  };

  async function activateTenant() {
    if (!pendingTenant) return;
    const r = await fetch("/api/admin/tenants/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      cache: "no-store",
      body: JSON.stringify({ tenantId: pendingTenant }),
    });
    if (!r.ok) {
      const msg = await r.text().catch(() => "");
      alert(`No se pudo activar: ${msg || r.status}`);
      return;
    }
    const r2 = await fetch("/api/admin/whoami", {
      credentials: "include",
      cache: "no-store",
    });
    if (r2.ok) {
      const j2 = await r2.json();
      if (j2?.ok && j2.tenantId) {
        setTenantId(j2.tenantId);
        setWhoamiErr(null);
        setPage(1);
      }
    }
  }

  async function linkTenant() {
    if (!tenantId) return;
    setLinking(true);
    try {
      const r = await fetch("/api/admin/tenants/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ tenantId }),
      });
      if (!r.ok) {
        const msg = await r.text().catch(() => "");
        alert(`No se pudo vincular: ${msg || r.status}`);
        return;
      }
      const r2 = await fetch("/api/admin/whoami", {
        credentials: "include",
        cache: "no-store",
      });
      if (r2.ok) {
        const j2 = await r2.json();
        if (j2?.ok && j2.tenantId) {
          setTenantId(j2.tenantId);
          setWhoamiErr(null);
          setPage(1);
        }
      }
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">
            Busca por <strong>nombre</strong>, <strong>teléfono</strong> o filtra por <strong>fecha</strong>.
          </p>
          <div className="mt-2 flex items-center gap-2">
            {tenantId ? (
              <span className="text-xs px-2 py-1 rounded-full border bg-gray-50">
                Tenant activo: {tenantId.slice(0, 8)}…
              </span>
            ) : (
              <span className="text-xs text-red-600">
                No se pudo obtener el tenant ({whoamiErr}).
              </span>
            )}
            {softError && (
              <span className="text-xs px-2 py-1 rounded-full border border-amber-300 bg-amber-50 text-amber-700">
                {softError}
              </span>
            )}
          </div>
        </div>

        {/* Fallback: elegir tenant activo desde la UI */}
        {!tenantId && (
          <div className="flex items-center gap-2">
            <select
              className="border rounded-lg px-3 py-2 w-[340px]"
              value={pendingTenant}
              onChange={(e) => setPendingTenant(e.target.value)}
            >
              <option value="">Selecciona un negocio…</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              disabled={!pendingTenant}
              onClick={activateTenant}
              className="px-3 py-2 rounded-lg border disabled:opacity-50"
            >
              Activar
            </button>
          </div>
        )}
      </div>

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

      <div className="rounded-2xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left p-3">Hora</th>
              <th className="text-left p-3">Cliente</th>
              <th className="text-left p-3">Teléfono</th>
              <th className="text-left p-3">Staff</th>
              <th className="text-right p-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td className="p-4" colSpan={5}>Cargando…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="p-6 text-center text-gray-500" colSpan={5}>
                  Sin resultados
                </td>
              </tr>
            ) : (
              rows.map((b) => {
                const hour = new Date(b.starts_at).toLocaleTimeString("es-DO", {
                  hour: "2-digit",
                  minute: "2-digit",
                });
                return (
                  <tr key={b.id} className="border-t">
                    <td className="p-3">{hour}</td>
                    <td className="p-3">{b.customer_name ?? "Cliente"}</td>
                    <td className="p-3">{b.customer_phone ?? "-"}</td>
                    <td className="p-3">{b.staff_name ?? "Equipo"}</td>
                    <td className="p-3">
                      <div className="flex justify-end">
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

      {total > 20 && (
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
            disabled={rows.length < 20}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-2 rounded-lg border disabled:opacity-50"
          >
            Siguiente
          </button>
        </div>
      )}

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
