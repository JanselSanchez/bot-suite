"use client";
import { useEffect, useState } from "react";

export default function CreateBookingDialog({ tenantId, onCreated }:{
  tenantId: string;
  onCreated?: ()=>void;
}) {
  const [open, setOpen] = useState(false);
  const [services, setServices] = useState<any[]>([]);
  const [resources, setResources] = useState<any[]>([]);
  const [form, setForm] = useState<any>({
    phone: "",
    customerName: "",
    serviceId: "",
    resourceId: "",
    starts: "",
    durationMin: 60,
    notes: "",
  });

  useEffect(() => {
    if (!open) return;
    (async () => {
      const [svcs, res] = await Promise.all([
        fetch(`/api/admin/bookings/services?tenantId=${tenantId}`).then(r=>r.json()).catch(()=>({data:[]})),
        fetch(`/api/admin/bookings/resources?tenantId=${tenantId}`).then(r=>r.json()).catch(()=>({data:[]})),
      ]);
      setServices(svcs.data || []);
      setResources(res.data || []);
    })();
  }, [open, tenantId]);

  async function create() {
    const startsAt = new Date(form.starts);
    const endsAt = new Date(startsAt.getTime() + (form.durationMin || 60) * 60 * 1000);
    const res = await fetch("/api/admin/bookings/create", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        tenantId,
        phone: form.phone,
        customerName: form.customerName || "Cliente",
        serviceId: form.serviceId,
        resourceId: form.resourceId,
        startsAtISO: startsAt.toISOString(),
        endsAtISO: endsAt.toISOString(),
        notes: form.notes || null,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(()=> "");
      alert(`Error creando: ${t || res.status}`);
      return;
    }
    setOpen(false);
    onCreated?.();
  }

  return (
    <>
      <button className="bg-black text-white px-3 py-2 rounded" onClick={()=>setOpen(true)}>+ Nueva reserva</button>
      {open && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-4 w-full max-w-lg space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="font-medium">Crear reserva</h3>
              <button className="text-gray-500" onClick={()=>setOpen(false)}>✕</button>
            </div>

            <input className="border rounded px-2 py-1 w-full" placeholder="Teléfono" value={form.phone} onChange={e=>setForm({...form, phone:e.target.value})} />
            <input className="border rounded px-2 py-1 w-full" placeholder="Nombre cliente (opcional)" value={form.customerName} onChange={e=>setForm({...form, customerName:e.target.value})} />

            <div className="grid grid-cols-2 gap-2">
              <select className="border rounded px-2 py-1" value={form.serviceId} onChange={e=>setForm({...form, serviceId:e.target.value})}>
                <option value="">Servicio</option>
                {services.map((s:any)=><option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select className="border rounded px-2 py-1" value={form.resourceId} onChange={e=>setForm({...form, resourceId:e.target.value})}>
                <option value="">Recurso</option>
                {resources.map((r:any)=><option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <input type="datetime-local" className="border rounded px-2 py-1" value={form.starts} onChange={e=>setForm({...form, starts:e.target.value})} />
              <input type="number" className="border rounded px-2 py-1" min={15} step={15} value={form.durationMin} onChange={e=>setForm({...form, durationMin: parseInt(e.target.value)})} />
            </div>

            <textarea className="border rounded px-2 py-1 w-full" placeholder="Notas (opcional)" value={form.notes} onChange={e=>setForm({...form, notes:e.target.value})} />

            <div className="flex justify-end gap-2">
              <button className="border rounded px-3 py-2" onClick={()=>setOpen(false)}>Cancelar</button>
              <button className="bg-black text-white px-3 py-2 rounded" onClick={create}>Crear</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
