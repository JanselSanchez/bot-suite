"use client";
import { useEffect, useState } from "react";

const WEEK = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];

type UiRow = {
  id: string | null;
  weekday: number;        // 0..6
  start_hm: string;       // "HH:MM"
  end_hm: string;         // "HH:MM"
  is_open: boolean;       // UI-friendly (invertimos is_closed)
};

export default function BusinessHoursEditor({
  tenantId,
  resourceId,            // se ignora en el endpoint, pero lo dejamos por compatibilidad
}:{
  tenantId: string;
  resourceId: string | null;
}) {
  const [rows, setRows] = useState<UiRow[]>(
    Array.from({length:7}, (_,i)=>({
      id: null,
      weekday: i,
      start_hm: "09:00",
      end_hm: "18:00",
      is_open: i !== 0,   // Domingo cerrado por defecto
    }))
  );
  const [loading, setLoading] = useState(false);

  // ---- helpers de mapeo ----
  function apiToUi(r:any): UiRow {
    return {
      id: r.id ?? null,
      // usa 'weekday' si existe; si no, cae a 'dow'
      weekday: typeof r.weekday === "number" ? r.weekday : (r.dow ?? 0),
      start_hm: (r.open_time ?? "").slice(0,5),   // "HH:MM"
      end_hm: (r.close_time ?? "").slice(0,5),    // "HH:MM"
      is_open: r.is_closed === false,             // invertimos
    };
  }
  function uiToApi(r:UiRow) {
    return {
      id: r.id ?? undefined,
      tenant_id: tenantId,
      dow: r.weekday,
      weekday: r.weekday,
      is_closed: !r.is_open,
      open_time: r.start_hm || null,
      close_time: r.end_hm || null,
    };
  }

  async function load() {
    const params = new URLSearchParams({ tenantId });
    if (resourceId) params.set("resourceId", resourceId); // el API lo ignora; no rompe
    const res = await fetch(`/api/admin/business-hours?${params.toString()}`);
    const { data } = await res.json();

    // Normalizamos SIEMPRE 7 filas (0..6)
    const byWeekday: Record<number, UiRow> = {};
    (data ?? []).forEach((r:any) => {
      const ui = apiToUi(r);
      byWeekday[ui.weekday] = ui;
    });

    const normalized: UiRow[] = Array.from({length:7}, (_,i)=>(
      byWeekday[i] ?? {
        id: null,
        weekday: i,
        start_hm: "09:00",
        end_hm: "18:00",
        is_open: i !== 0,
      }
    ));
    setRows(normalized);
  }

  useEffect(()=>{ void load(); }, [tenantId, resourceId]);

  async function saveRow(r: UiRow) {
    setLoading(true);
    try {
      const body = JSON.stringify(uiToApi(r));
      const headers = { "Content-Type": "application/json" };
      if (r.id) {
        await fetch("/api/admin/business-hours", { method:"PUT", headers, body });
      } else {
        await fetch("/api/admin/business-hours", { method:"POST", headers, body });
      }
      await load();
    } finally { setLoading(false); }
  }

  async function remove(id: string) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ id });
      await fetch(`/api/admin/business-hours?${params.toString()}`, { method:"DELETE" });
      await load();
    } finally { setLoading(false); }
  }

  return (
    <div className="rounded border p-4 space-y-3">
      <h2 className="font-medium">Horarios por día</h2>

      <div className="grid gap-2" style={{gridTemplateColumns:"100px 130px 130px 110px 120px"}}>
        <div className="text-sm text-gray-500">Día</div>
        <div className="text-sm text-gray-500">Desde</div>
        <div className="text-sm text-gray-500">Hasta</div>
        <div className="text-sm text-gray-500">Abierto</div>
        <div className="text-sm text-gray-500">Acciones</div>

        {rows.map((r, idx)=>(
          <div className="contents" key={r.weekday}>
            <div className="py-1">{WEEK[r.weekday]}</div>

            <input
              className="border rounded px-2 py-1"
              type="time"
              value={r.start_hm ?? ""}                         // nunca undefined
              onChange={e=>{
                const v = e.target.value;
                const copy = [...rows];
                copy[idx] = { ...r, start_hm: v };
                setRows(copy);
              }}
              disabled={!r.is_open}
            />

            <input
              className="border rounded px-2 py-1"
              type="time"
              value={r.end_hm ?? ""}                           // nunca undefined
              onChange={e=>{
                const v = e.target.value;
                const copy = [...rows];
                copy[idx] = { ...r, end_hm: v };
                setRows(copy);
              }}
              disabled={!r.is_open}
            />

            <input
              type="checkbox"
              checked={!!r.is_open}                            // SIEMPRE boolean
              onChange={e=>{
                const copy = [...rows];
                copy[idx] = { ...r, is_open: e.target.checked };
                setRows(copy);
              }}
            />

            <div className="flex gap-2">
              <button
                className="border rounded px-2 py-1"
                disabled={loading}
                onClick={()=>saveRow(r)}
              >
                {r.id ? "Actualizar" : "Guardar"}
              </button>

              {r.id && (
                <button
                  className="border rounded px-2 py-1"
                  disabled={loading}
                  onClick={()=>remove(r.id!)}
                >
                  Eliminar
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
