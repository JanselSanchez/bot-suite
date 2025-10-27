'use client'
import { fmtDateTimeRD, renderTemplateBody } from '@/app/lib/format-esdo'
import { useEffect, useMemo, useState } from 'react'

export type Template = {
  id: string
  tenant_id: string
  channel: 'whatsapp' | 'sms' | 'email'
  event: 'booking_confirmed' | 'booking_rescheduled' | 'booking_cancelled' | 'reminder_24h' | 'reminder_2h' | 'payment_required'
  title: string
  body: string
  active: boolean
  created_at: string
}

type Props = {
  value: Template | null
  onClose: () => void
  onSaved: (next: Template) => void
}

export default function TemplateEditor({ value, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(value?.title ?? '')
  const [body, setBody] = useState(value?.body ?? '')
  const [active, setActive] = useState(value?.active ?? true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setTitle(value?.title ?? '')
    setBody(value?.body ?? '')
    setActive(value?.active ?? true)
  }, [value])

  const sample = useMemo(() => ({
    customer_name: 'Ana Pérez',
    resource_name: 'Estilista María',
    starts_at: fmtDateTimeRD(new Date(Date.now() + 36*60*60*1000)),
    ends_at: fmtDateTimeRD(new Date(Date.now() + 38*60*60*1000)),
    business_name: 'Creativa Studio',
    address: 'Av. Winston Churchill 123',
  }), [])

  const preview = useMemo(() => renderTemplateBody(body, sample), [body, sample])

  async function save() {
    if (!value) return
    setSaving(true)
    const res = await fetch(`/api/templates/${value.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body, active })
    })
    setSaving(false)
    if (!res.ok) {
      const err = await res.text()
      alert('Error guardando plantilla: ' + err)
      return
    }
    onSaved(await res.json())
  }

  if (!value) return null

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white w-full max-w-5xl rounded-2xl shadow-xl grid grid-cols-1 md:grid-cols-2 gap-6 p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Editar plantilla</h2>
            <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-900">Cerrar</button>
          </div>
          <div className="grid gap-2">
            <label className="text-sm text-gray-600">Título</label>
            <input className="border rounded-lg p-2" value={title} onChange={e=>setTitle(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <label className="text-sm text-gray-600">Cuerpo</label>
            <textarea className="border rounded-lg p-2 h-56" value={body} onChange={e=>setBody(e.target.value)} />
            <p className="text-xs text-gray-500">
              Variables: {'{'}{'{'}customer_name{'}'}{'}'}, {'{'}{'{'}resource_name{'}'}{'}'}, {'{'}{'{'}starts_at{'}'}{'}'}, {'{'}{'{'}ends_at{'}'}{'}'}
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)} />
            Activa
          </label>
          <div className="flex gap-3">
            <button onClick={save} disabled={saving} className="bg-black text-white px-4 py-2 rounded-xl disabled:opacity-50">
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={onClose} className="px-4 py-2 rounded-xl border">Cancelar</button>
          </div>
        </div>
        <div className="border-l pl-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Previsualización</h3>
          <div className="bg-gray-50 rounded-xl p-4 whitespace-pre-wrap text-sm">
            <div className="text-xs uppercase text-gray-500 mb-1">WhatsApp · {value.event}</div>
            <div className="font-semibold mb-2">{title || '(Sin título)'}</div>
            <p>{preview || '(Escribe el cuerpo para ver vista previa)'}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
