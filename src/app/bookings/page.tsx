// src/app/bookings/page.tsx
"use client";

import { useEffect, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import FiltersBar from "./FiltersBar";
import CreateBookingDialog from "./CreateBookingDialog";

type BookingStatus = "pending" | "confirmed" | "cancelled" | "no_show" | string;

type BookingFilters = {
  q?: string;
  status?: string[];
  serviceId?: string;
  resourceId?: string;
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
  page?: number;
  pageSize?: number;
};

interface BookingRow {
  id: string;
  starts_at: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  status: BookingStatus;
  // Puedes añadir más campos si tu API los devuelve
}

// Cliente Supabase para el browser
const sb: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DEFAULT_PAGE_SIZE = 20;

export default function BookingsPage() {
  const [tenantId, setTenantId] = useState<string>("");
  const [filters, setFilters] = useState<BookingFilters>({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const [rows, setRows] = useState<BookingRow[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);

  // 1) Obtener tenant del usuario logueado
  useEffect(() => {
    (async () => {
      try {
        const {
          data: { user },
        } = await sb.auth.getUser();

        if (!user) return;

        const { data: tu, error } = await sb
          .from("tenant_users")
          .select("tenant_id")
          .eq("user_id", user.id)
          .order("role", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (error) {
          console.error("[BookingsPage] error tenant_users:", error);
          return;
        }

        if (tu?.tenant_id) setTenantId(tu.tenant_id);
      } catch (e) {
        console.error("[BookingsPage] error getUser/tenant:", e);
      }
    })();
     
  }, []);

  // 2) Cargar reservas desde tu API
  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        tenantId,
        page: String(filters.page || 1),
        pageSize: String(filters.pageSize || DEFAULT_PAGE_SIZE),
      });

      if (filters.q) params.set("q", filters.q);
      if (filters.status?.length) params.set("status", filters.status.join(","));
      if (filters.serviceId) params.set("serviceId", filters.serviceId);
      if (filters.resourceId) params.set("resourceId", filters.resourceId);
      if (filters.from) params.set("from", `${filters.from}T00:00:00`);
      if (filters.to) params.set("to", `${filters.to}T23:59:59`);

      const res = await fetch(`/api/admin/bookings/list?${params.toString()}`, {
        method: "GET",
      });

      if (!res.ok) {
        console.error("[BookingsPage] API /bookings/list status:", res.status);
        setRows([]);
        setTotal(0);
        return;
      }

      const j: {
        data?: BookingRow[];
        total?: number;
      } = await res.json();

      setRows(j.data ?? []);
      setTotal(j.total ?? 0);
    } catch (e) {
      console.error("[BookingsPage] error cargando bookings:", e);
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  // 3) Recargar cuando hay tenantId o filtros nuevos
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, filters]);

  const currentPage = filters.page || 1;
  const pageSize = filters.pageSize || DEFAULT_PAGE_SIZE;
  const totalPages =
    pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-2xl font-semibold">Reservas</h1>
      </div>

      {!tenantId && (
        <p className="text-sm text-gray-500">Cargando negocio…</p>
      )}

      {tenantId && (
        <div className="flex items-center justify-between mb-3 gap-4">
          <FiltersBar
            tenantId={tenantId}
            onChange={(f: Partial<BookingFilters>) =>
              setFilters((prev) => ({
                ...prev,
                ...f,
                page: 1, // reset página al cambiar filtros
              }))
            }
          />
          <CreateBookingDialog tenantId={tenantId} onCreated={load} />
        </div>
      )}

      {loading && (
        <p className="text-sm text-gray-500">Cargando reservas…</p>
      )}

      {!loading && tenantId && rows.length === 0 && (
        <p className="text-sm text-gray-500">No hay reservas.</p>
      )}

      {!loading && rows.length > 0 && (
        <>
          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Fecha</th>
                  <th className="px-3 py-2 text-left font-medium">Cliente</th>
                  <th className="px-3 py-2 text-left font-medium">Estado</th>
                  <th className="px-3 py-2 text-left font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const startsAt = new Date(r.starts_at);
                  const fecha = startsAt.toLocaleString("es-DO", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  });

                  const cliente =
                    r.customer_name ||
                    r.customer_phone ||
                    "Cliente sin nombre";

                  return (
                    <tr key={r.id} className="border-t">
                      <td className="px-3 py-2">{fecha}</td>
                      <td className="px-3 py-2">{cliente}</td>
                      <td className="px-3 py-2 capitalize">{r.status}</td>
                      <td className="px-3 py-2 space-x-2">
                        {/* Aquí podrías abrir tu RescheduleDialog real */}
                        {/* <RescheduleDialog
                          bookingId={r.id}
                          tenantId={tenantId}
                          onDone={load}
                        /> */}
                        <button
                          className="border rounded px-2 py-1 text-xs"
                          onClick={async () => {
                            const reason =
                              window.prompt(
                                "Motivo de cancelación (opcional)"
                              ) || undefined;
                            const res = await fetch(
                              "/api/admin/bookings/cancel",
                              {
                                method: "POST",
                                headers: {
                                  "Content-Type": "application/json",
                                },
                                body: JSON.stringify({
                                  tenantId,
                                  bookingId: r.id,
                                  reason,
                                }),
                              }
                            );
                            if (!res.ok) {
                               
                              window.alert("Error al cancelar");
                            } else {
                              void load();
                            }
                          }}
                        >
                          Cancelar
                        </button>
                        <button
                          className="border rounded px-2 py-1 text-xs"
                          onClick={async () => {
                            const res = await fetch(
                              "/api/admin/bookings/no-show",
                              {
                                method: "POST",
                                headers: {
                                  "Content-Type": "application/json",
                                },
                                body: JSON.stringify({
                                  tenantId,
                                  bookingId: r.id,
                                }),
                              }
                            );
                            if (!res.ok) {
                               
                              window.alert("Error marcando no-show");
                            } else {
                              void load();
                            }
                          }}
                        >
                          No-show
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Paginación simple */}
          <div className="mt-3 flex items-center gap-2 text-sm">
            <button
              className="border rounded px-2 py-1 disabled:opacity-50"
              disabled={currentPage <= 1}
              onClick={() =>
                setFilters((f) => ({
                  ...f,
                  page: (f.page || 1) - 1,
                }))
              }
            >
              Anterior
            </button>
            <span>
              Página {currentPage} de {totalPages}
            </span>
            <button
              className="border rounded px-2 py-1 disabled:opacity-50"
              disabled={currentPage >= totalPages}
              onClick={() =>
                setFilters((f) => ({
                  ...f,
                  page: (f.page || 1) + 1,
                }))
              }
            >
              Siguiente
            </button>
            <span className="text-gray-500 ml-2">{total} resultados</span>
          </div>
        </>
      )}
    </div>
  );
}
