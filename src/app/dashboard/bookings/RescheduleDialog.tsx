"use client";
import { useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  booking: {
    id: string;
    tenant_id: string;
    service_id: string;
    starts_at: string;
    resource_id: string | null;
  };
};

// 🕓 Convierte una fecha local (YYYY-MM-DD) a "medianoche RD" expresada en UTC
function rdLocalMidnightToUTC(dateStr: string): string {
  const RD_OFFSET_MIN = 240; // -4h
  const [y, m, d] = dateStr.split("-").map(Number);
  // construimos medianoche local (Y-M-D 00:00) y la proyectamos a UTC
  const localMidnight = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const utcMs = localMidnight + RD_OFFSET_MIN * 60 * 1000;
  return new Date(utcMs).toISOString();
}

export default function RescheduleDialog({ open, onOpenChange, booking }: Props) {
  const [date, setDate] = useState(() =>
    new Date(booking.starts_at).toISOString().slice(0, 10)
  );
  const [slots, setSlots] = useState<
    Array<{ start: string; end: string; resource_name: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const dayLabel = useMemo(() => {
    try {
      return new Date(date).toLocaleDateString("es-DO", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });
    } catch {
      return date;
    }
  }, [date]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      try {
        // ✅ convertimos fecha local a UTC para el backend
        const dateUTC = rdLocalMidnightToUTC(date);
        const url = `/api/admin/availability?tenantId=${booking.tenant_id}&serviceId=${booking.service_id}&date=${encodeURIComponent(
          dateUTC
        )}`;
        const res = await fetch(url);
        const j = await res.json();
        setSlots(j.data ?? []);
      } catch (e) {
        console.error("[RescheduleDialog] fetch error:", e);
        setSlots([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, booking.service_id, booking.tenant_id, date]);

  async function pick(i: number) {
    const chosen = slots[i];
    if (!chosen) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/bookings/${booking.id}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: booking.tenant_id,
          starts_at: chosen.start,
          ends_at: chosen.end,
        }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "No se pudo reprogramar");
      onOpenChange(false);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Reprogramar</h3>
          <button
            onClick={() => onOpenChange(false)}
            className="px-2 py-1 rounded hover:bg-gray-100"
          >
            ✕
          </button>
        </div>

        <label className="text-sm">Fecha</label>
        <input
          type="date"
          className="w-full border rounded-md px-3 py-2"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <p className="text-xs text-gray-500">
          Mostrando opciones para {dayLabel}
        </p>

        {loading ? (
          <p className="text-sm">Cargando horarios…</p>
        ) : slots.length === 0 ? (
          <p className="text-sm">No hay horarios disponibles ese día.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 max-h-60 overflow-auto">
            {slots.map((s, i) => (
              <li key={i}>
                <button
                  disabled={saving}
                  onClick={() => pick(i)}
                  className="w-full border rounded-lg px-3 py-2 text-left hover:bg-gray-50 disabled:opacity-50"
                >
                  <div className="font-medium">
                    {new Date(s.start).toLocaleTimeString("es-DO", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                  <div className="text-xs text-gray-500">{s.resource_name}</div>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={() => onOpenChange(false)}
            className="px-3 py-2 rounded-lg border"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
