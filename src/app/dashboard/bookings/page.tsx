"use client";
import { useEffect, useMemo, useState } from "react";
import RescheduleDialog from "./RescheduleDialog";

type Booking = {
  id: string;
  tenant_id: string;
  service_id: string;
  resource_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  staff_name: string | null;
  starts_at: string;
  ends_at: string;
  status: "confirmed" | "unconfirmed" | "cancelled" | "rescheduled" | "no_show";
};

export default function AdminBookingsPage() {
  // tenant de prueba: lee de ENV o deja input manual
  const [tenantId, setTenantId] = useState<string>(
    process.env.NEXT_PUBLIC_TEST_TENANT_ID || ""
  );
  const [scope, setScope] = useState<"today" | "upcoming" | "past">("today");
  const [rows, setRows] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<null | {
    id: string;
    tenant_id: string;
    service_id: string;
    starts_at: string;
    resource_id: string | null;
  }>(null);

  const title = useMemo(() => {
    if (scope === "today") return "Citas de Hoy";
    if (scope === "upcoming") return "Próximas Citas";
    return "Citas Pasadas";
  }, [scope]);

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/bookings?tenantId=${tenantId}&scope=${scope}`
      );
      const j = await res.json();
      setRows(j.data ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, tenantId]);

  async function updateStatus(id: string, status: Booking["status"]) {
    async function doPost(payload: any) {
      const res = await fetch(`/api/admin/bookings/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      return { ok: res.ok && j.ok, j, res };
    }
  
    const first = await doPost({ status, tenantId });
  
    // Si ventana impide cancelar, pedir confirmación (force)
    if (!first.ok && first.res.status === 409 && first.j?.error === "CANCEL_WINDOW_VIOLATION") {
      const msg = first.j?.message || "No se puede cancelar por la política.";
      const agree = confirm(`${msg}\n\n¿Cancelar de todos modos?`);
      if (!agree) return;
      const forced = await doPost({ status, tenantId, force: true });
      if (!forced.ok) {
        alert(forced.j?.error || "No se pudo actualizar");
        return;
      }
    } else if (!first.ok) {
      alert(first.j?.error || "No se pudo actualizar");
      return;
    }
  
    load();
  }
  

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">{title}</h1>
        <div className="flex items-center gap-2">
          <input
            placeholder="tenant_id"
            className="border rounded-lg px-2 py-1 w-64"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
          />
          <button
            onClick={load}
            className="px-3 py-2 rounded-lg border hover:bg-gray-50"
          >
            Recargar
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setScope("today")}
            className={`px-3 py-2 rounded-lg border ${
              scope === "today" ? "bg-gray-100" : ""
            }`}
          >
            Hoy
          </button>
          <button
            onClick={() => setScope("upcoming")}
            className={`px-3 py-2 rounded-lg border ${
              scope === "upcoming" ? "bg-gray-100" : ""
            }`}
          >
            Próximas
          </button>
          <button
            onClick={() => setScope("past")}
            className={`px-3 py-2 rounded-lg border ${
              scope === "past" ? "bg-gray-100" : ""
            }`}
          >
            Pasadas
          </button>
        </div>
      </div>

      <div className="rounded-2xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left p-3">Hora</th>
              <th className="text-left p-3">Cliente</th>
              <th className="text-left p-3">Staff</th>
              <th className="text-left p-3">Estado</th>
              <th className="text-right p-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="p-3" colSpan={5}>
                  Cargando…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="p-6 text-center text-gray-500" colSpan={5}>
                  Sin resultados
                </td>
              </tr>
            ) : (
              rows.map((b) => {
                const startLabel = new Date(b.starts_at).toLocaleTimeString(
                  "es-DO",
                  { hour: "2-digit", minute: "2-digit" }
                );
                return (
                  <tr key={b.id} className="border-t">
                    <td className="p-3">{startLabel}</td>
                    <td className="p-3">
                      {b.customer_name ?? "Cliente"}
                      <span className="text-gray-400">
                        {" "}
                        ({b.customer_phone ?? "-"})
                      </span>
                    </td>
                    <td className="p-3">{b.staff_name ?? "Equipo"}</td>
                    <td className="p-3 capitalize">
                      {b.status.replace("_", " ")}
                    </td>
                    <td className="p-3">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => updateStatus(b.id, "cancelled")}
                          className="px-2 py-1 rounded-lg border hover:bg-gray-50"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={() =>
                            setSelected({
                              id: b.id,
                              tenant_id: tenantId,
                              service_id: b.service_id,
                              starts_at: b.starts_at,
                              resource_id: b.resource_id,
                            })
                          }
                          className="px-2 py-1 rounded-lg border hover:bg-gray-50"
                        >
                          Reprogramar
                        </button>
                        {scope !== "past" && (
                          <button
                            onClick={() => updateStatus(b.id, "no_show")}
                            className="px-2 py-1 rounded-lg border hover:bg-gray-50"
                          >
                            No show
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <RescheduleDialog
          open={!!selected}
          onOpenChange={(v) => {
            if (!v) {
              setSelected(null);
              load();
            }
          }}
          booking={selected}
        />
      )}
    </div>
  );
}
