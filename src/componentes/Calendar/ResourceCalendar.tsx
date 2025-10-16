"use client";
import { useEffect, useMemo, useState } from "react";

type Booking = {
  id: string;
  starts_at: string;
  ends_at: string;
  resource_id: string;
  customer_phone?: string;
};

function hoursRange(from=8, to=20) {
  return Array.from({length: to-from+1}).map((_,i)=>from+i);
}
function fmtHM(d: Date) {
  return d.toTimeString().slice(0,5);
}

export default function ResourceCalendar({ tenantId, resourceId }:{
  tenantId: string; resourceId: string;
}) {
  const [day, setDay] = useState<string>(new Date().toISOString().slice(0,10));
  const [rows, setRows] = useState<Booking[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);

  const dayStart = useMemo(()=>new Date(`${day}T00:00:00`), [day]);
  const dayEnd = useMemo(()=>new Date(`${day}T23:59:59`), [day]);

  async function load() {
    const from = dayStart.toISOString(), to = dayEnd.toISOString();
    const qs = new URLSearchParams({ tenantId, resourceId, from, to }).toString();
    // usa tu API actual si ya tienes; por simplicidad, consultamos directo a Supabase desde el browser
    const res = await fetch(`/api/admin/bookings?${qs}`).catch(()=>null); // si no existe endpoint, omite
    if (res && res.ok) {
      const { data } = await res.json();
      setRows(data || []);
      return;
    }
    // fallback: consulta directa (necesita RLS acorde). Si no, puedes reemplazar por tu endpoint existente.
    // setRows([]);
  }

  useEffect(()=>{ void load(); }, [tenantId, resourceId, day]);

  function cellDate(h:number, m:number) {
    const d = new Date(dayStart);
    d.setHours(h, m, 0, 0);
    return d;
  }

  async function onDropCell(h:number) {
    if (!dragId) return;
    const bk = rows.find(r=>r.id===dragId);
    if (!bk) return;

    const duration = new Date(bk.ends_at).getTime() - new Date(bk.starts_at).getTime();
    const newStart = cellDate(h, 0);
    const newEnd = new Date(newStart.getTime()+duration);

    // llama a tu endpoint de reprogramar ya existente
    await fetch(`/api/admin/id/reschedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        bookingId: bk.id,
        newStartsAt: newStart.toISOString(),
        newResourceId: resourceId, // mover entre recursos requiere UI extra
      }),
    });

    setDragId(null);
    await load();
  }

  return (
    <div className="rounded border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <button className="border px-2 py-1 rounded" onClick={()=>{
          const d = new Date(day); d.setDate(d.getDate()-1); setDay(d.toISOString().slice(0,10));
        }}>◀</button>
        <input type="date" className="border px-2 py-1 rounded" value={day} onChange={e=>setDay(e.target.value)} />
        <button className="border px-2 py-1 rounded" onClick={()=>{
          const d = new Date(day); d.setDate(d.getDate()+1); setDay(d.toISOString().slice(0,10));
        }}>▶</button>
      </div>

      <div className="relative grid" style={{gridTemplateColumns:"80px 1fr", borderTop:"1px solid #e5e7eb"}}>
        {hoursRange(8,20).map(h=>(
          <div key={h} className="contents">
            <div className="border-b border-r p-2 text-xs text-gray-500">{`${String(h).padStart(2,"0")}:00`}</div>
            <div
              className="border-b min-h-[56px]"
              onDragOver={e=>e.preventDefault()}
              onDrop={()=>onDropCell(h)}
            />
          </div>
        ))}
        {/* eventos del día */}
        {rows.map(bk=>{
          const s = new Date(bk.starts_at), e = new Date(bk.ends_at);
          const top = ((s.getHours()-8)*56) + (s.getMinutes()/60)*56;
          const height = Math.max(28, (e.getTime()-s.getTime())/3600000*56);
          return (
            <div
              key={bk.id}
              draggable
              onDragStart={()=>setDragId(bk.id)}
              className="absolute left-[80px] right-2 bg-blue-100 border border-blue-300 rounded p-1 text-xs cursor-move"
              style={{ top, height }}
              title={`${fmtHM(s)}-${fmtHM(e)}  ${bk.customer_phone || ""}`}
            >
              {fmtHM(s)} - {fmtHM(e)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
