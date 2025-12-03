"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { addDays, startOfWeek, endOfWeek, format } from "date-fns";
import { es } from "date-fns/locale";
// @ts-ignore – usamos nuestra d.ts mínima
import { Calendar as RBCalendar, dateFnsLocalizer } from "react-big-calendar";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { CalendarDays, Save, RefreshCw } from "lucide-react";
import { useActiveTenant } from "@/app/providers/active-tenant";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ---------- Date-fns localizer ----------
const localizer = dateFnsLocalizer({
  format: (date: Date, fmt: string) => format(date, fmt, { locale: es }),
  parse: (str: string) => new Date(str),
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay: (date: Date) => date.getDay(),
  locales: { es },
});

// ---------- Types ----------
type BusinessHour = {
  id?: string;
  tenant_id: string;
  dow: number; // 0..6
  is_closed: boolean;
  open_time: string | null;  // "09:00" o "09:00:00"
  close_time: string | null; // "18:00" o "18:00:00"
};

type Booking = {
  id: string;
  tenant_id: string;
  starts_at: string; // ISO
  ends_at: string;   // ISO
  status?: string | null;
  title?: string | null;
  resource_id?: string | null;
};

type CalEvent = { start: Date; end: Date; title: string; resource?: any };

// ---------- Helpers ----------
const DOW_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function hmsToParts(hms: string) {
  const [h, m] = hms.split(":").map(Number);
  return { h, m };
}
function pad2(n: number) {
  return n.toString().padStart(2, "0");
}
function toHHMM(t?: string | null) {
  if (!t) return "";
  const [h, m] = t.split(":");
  return `${pad2(Number(h))}:${pad2(Number(m))}`;
}
function buildDateOnWeek(weekStart: Date, dow: number, hms: string) {
  const { h, m } = hmsToParts(hms);
  const d = addDays(weekStart, dow);
  const base = new Date(d);
  base.setHours(h, m, 0, 0);
  return base;
}

// Ventanas abiertas (maneja cruce medianoche)
function weeklyOpenWindows(weekStart: Date, bh: BusinessHour[]) {
  const out: { start: Date; end: Date }[] = [];
  for (const d of bh) {
    if (d.is_closed || !d.open_time || !d.close_time) continue;
    const open = buildDateOnWeek(weekStart, d.dow, toHHMM(d.open_time));
    const close = buildDateOnWeek(weekStart, d.dow, toHHMM(d.close_time));
    if (+close <= +open) {
      const end1 = new Date(open);
      end1.setHours(23, 59, 0, 0);
      out.push({ start: open, end: end1 });

      const start2 = new Date(open);
      start2.setDate(start2.getDate() + 1);
      start2.setHours(0, 0, 0, 0);
      out.push({ start: start2, end: close });
    } else {
      out.push({ start: open, end: close });
    }
  }
  return out;
}

// Slots de 30 min sin chocar reservas
function generateOfferableSlots(
  windows: { start: Date; end: Date }[],
  bookings: Booking[],
  stepMin = 30
) {
  const slots: { start: Date; end: Date }[] = [];
  for (const w of windows) {
    const cursor = new Date(w.start);
    while (+cursor < +w.end) {
      const end = new Date(cursor);
      end.setMinutes(end.getMinutes() + stepMin);
      if (+end > +w.end) break;

      const clash = bookings.some((b) => {
        const bs = new Date(b.starts_at);
        const be = new Date(b.ends_at);
        return +bs < +end && +be > +cursor;
      });

      if (!clash) slots.push({ start: new Date(cursor), end });
      cursor.setMinutes(cursor.getMinutes() + stepMin);
    }
  }
  return slots;
}

function withHM(base: Date, h: number, m = 0) {
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

// ---------- Component ----------
export default function AvailabilityPage() {
  const { tenantId, loading: loadingTenant } = useActiveTenant();

  const [currentWeek, setCurrentWeek] = useState<Date>(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  const [hours, setHours] = useState<BusinessHour[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const [bookings, setBookings] = useState<Booking[]>([]);

  const weekStart = useMemo(
    () => startOfWeek(currentWeek, { weekStartsOn: 1 }),
    [currentWeek]
  );
  const weekEnd = useMemo(
    () => endOfWeek(weekStart, { weekStartsOn: 1 }),
    [weekStart]
  );

  // ---------- Cargar business_hours ----------
  useEffect(() => {
    if (!tenantId || loadingTenant) return;
    (async () => {
      setLoading(true);

      const { data: bh, error } = await sb
        .from("business_hours")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("dow", { ascending: true });

      if (error) {
        console.error("Error cargando business_hours:", error);
        setHours([]);
        setLoading(false);
        return;
      }

      const byDow = new Map<number, BusinessHour>();
      (bh || []).forEach((r: any) => byDow.set(r.dow, r));

      const seven: BusinessHour[] = Array.from({ length: 7 }).map((_, dow) => {
        const r = byDow.get(dow);
        if (r) return r;
        return {
          tenant_id: tenantId,
          dow,
          is_closed: dow === 0,
          open_time: dow === 0 ? null : "09:00:00",
          close_time: dow === 0 ? null : "18:00:00",
        };
      });

      setHours(seven);
      setLoading(false);
    })();
  }, [tenantId, loadingTenant]);

  // ---------- Cargar bookings de la semana ----------
  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      const { data, error } = await sb
        .from("bookings")
        .select(
          "id, tenant_id, starts_at, ends_at, status, title, resource_id"
        )
        .eq("tenant_id", tenantId)
        .gte("starts_at", weekStart.toISOString())
        .lt("starts_at", addDays(weekEnd, 1).toISOString());

      if (error) {
        console.error("Error cargando bookings:", error);
        return;
      }
      setBookings(data || []);
    })();
  }, [tenantId, weekStart, weekEnd]);

  const openWindows = useMemo(
    () => (hours ? weeklyOpenWindows(weekStart, hours) : []),
    [hours, weekStart]
  );
  const offerable = useMemo(
    () => generateOfferableSlots(openWindows, bookings, 30),
    [openWindows, bookings]
  );

  const events: CalEvent[] = useMemo(() => {
    const openEvents: CalEvent[] = openWindows.map((w) => ({
      start: w.start,
      end: w.end,
      title: "Abierto",
      resource: { kind: "OPEN" },
    }));
    const bookingEvents: CalEvent[] = bookings.map((b) => ({
      start: new Date(b.starts_at),
      end: new Date(b.ends_at),
      title: b.title || "Reserva",
      resource: { kind: "BOOKING", status: b.status },
    }));
    return [...openEvents, ...bookingEvents];
  }, [openWindows, bookings]);

  async function saveAll() {
    if (!hours || !tenantId) return;
    setSaving(true);

    const payload = hours.map((h) => ({
      tenant_id: tenantId, // 🔥 aseguramos tenant_id SIEMPRE
      dow: h.dow,
      is_closed: h.is_closed,
      open_time:
        h.is_closed || !h.open_time ? null : `${toHHMM(h.open_time)}:00`,
      close_time:
        h.is_closed || !h.close_time ? null : `${toHHMM(h.close_time)}:00`,
    }));

    const { error } = await sb
      .from("business_hours")
      .upsert(payload, {
        onConflict: "tenant_id,dow", // 🔥 solo por tenant + día
      })
      .select();

    setSaving(false);

    if (error) {
      console.error("Error guardando business_hours:", error);
      alert("No se pudo guardar. Revisa consola y RLS.");
      return;
    }

    const { data: bh2 } = await sb
      .from("business_hours")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("dow", { ascending: true });

    setHours((bh2 || []) as BusinessHour[]);
    alert("✅ Horarios guardados.");
  }

  const loadingState = loadingTenant || loading || !hours;

  // ---------- Paginación de slots ----------
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(offerable.length / pageSize)),
    [offerable.length, pageSize]
  );

  useEffect(() => {
    setPage(1);
  }, [offerable.length, pageSize]);

  const paginated = useMemo(
    () =>
      offerable.slice(
        (page - 1) * pageSize,
        (page - 1) * pageSize + pageSize
      ),
    [offerable, page, pageSize]
  );

  // ---------- Render ----------
  return (
    <div className="px-4 sm:px-6 py-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <div className="rounded-xl p-2 bg-purple-50 ring-1 ring-purple-100">
          <CalendarDays className="w-5 h-5 text-purple-600" />
        </div>
        <div className="min-w-[180px]">
          <h1 className="text-lg sm:text-xl font-semibold">Disponibilidad</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            Define horarios por día y deja que el bot ofrezca los mejores
            horarios a tus clientes.
          </p>
        </div>

        <div className="w-full sm:w-auto sm:ml-auto flex flex-wrap gap-2 justify-end">
          <button
            onClick={() => setCurrentWeek(addDays(weekStart, -7))}
            className="rounded-lg px-3 py-1.5 text-xs sm:text-sm ring-1 ring-gray-200 hover:bg-gray-50"
          >
            ← Semana
          </button>
          <button
            onClick={() =>
              setCurrentWeek(startOfWeek(new Date(), { weekStartsOn: 1 }))
            }
            className="rounded-lg px-3 py-1.5 text-xs sm:text-sm ring-1 ring-gray-200 hover:bg-gray-50"
          >
            Hoy
          </button>
          <button
            onClick={() => setCurrentWeek(addDays(weekStart, 7))}
            className="rounded-lg px-3 py-1.5 text-xs sm:text-sm ring-1 ring-gray-200 hover:bg-gray-50"
          >
            Semana →
          </button>
          <button
            onClick={saveAll}
            disabled={saving || loadingState}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs sm:text-sm font-medium text-white hover:bg-black/90 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            Guardar
          </button>
        </div>
      </div>

      {/* Horarios semanales */}
      <section className="rounded-2xl border border-gray-100 bg-white p-4 sm:p-6 shadow-sm mb-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base sm:text-lg font-semibold">
            Horarios semanales
          </h2>
          <button
            onClick={() => {
              if (!hours) return;
              setHours(
                hours.map((h) => ({
                  ...h,
                  is_closed: h.dow === 0,
                  open_time: h.dow === 0 ? null : "09:00",
                  close_time: h.dow === 0 ? null : "18:00",
                }))
              );
            }}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] sm:text-xs ring-1 ring-gray-200 hover:bg-gray-50"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Predefinir 9–18 (Dom cerrado)
          </button>
        </div>

        <div className="divide-y">
          {loadingState && (
            <div className="py-8 text-center text-sm text-gray-400">
              Cargando horarios…
            </div>
          )}

          {!loadingState &&
            hours!.map((row) => (
              <div
                key={row.dow}
                className="flex flex-wrap items-center gap-3 py-3"
              >
                <div className="w-16 shrink-0 text-sm font-medium">
                  {DOW_LABELS[row.dow]}
                </div>

                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300"
                    checked={!row.is_closed}
                    onChange={(e) => {
                      const open = e.target.checked;
                      setHours((prev) =>
                        prev!.map((h) =>
                          h.dow === row.dow
                            ? {
                                ...h,
                                is_closed: !open,
                                open_time: open
                                  ? row.open_time
                                    ? toHHMM(row.open_time)
                                    : "09:00"
                                  : null,
                                close_time: open
                                  ? row.close_time
                                    ? toHHMM(row.close_time)
                                    : "18:00"
                                  : null,
                              }
                            : h
                        )
                      );
                    }}
                  />
                  <span>Abierto</span>
                </label>

                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <input
                    type="time"
                    className="w-24 rounded-md border border-gray-200 px-2 py-1 text-xs sm:text-sm disabled:opacity-50"
                    disabled={row.is_closed}
                    value={
                      row.is_closed ? "" : toHHMM(row.open_time || "09:00")
                    }
                    onChange={(e) =>
                      setHours((prev) =>
                        prev!.map((h) =>
                          h.dow === row.dow
                            ? { ...h, open_time: e.target.value }
                            : h
                        )
                      )
                    }
                  />
                  <span className="text-gray-400 text-xs">a</span>
                  <input
                    type="time"
                    className="w-24 rounded-md border border-gray-200 px-2 py-1 text-xs sm:text-sm disabled:opacity-50"
                    disabled={row.is_closed}
                    value={
                      row.is_closed ? "" : toHHMM(row.close_time || "18:00")
                    }
                    onChange={(e) =>
                      setHours((prev) =>
                        prev!.map((h) =>
                          h.dow === row.dow
                            ? { ...h, close_time: e.target.value }
                            : h
                        )
                      )
                    }
                  />
                </div>
              </div>
            ))}
        </div>

        <p className="mt-4 text-[11px] sm:text-xs text-gray-500">
          * Si la hora de cierre es menor que la de apertura, se interpretará
          como horario que <b>cruza medianoche</b>.
        </p>
      </section>

      {/* Calendario semanal - escondido en móvil para no matar la pantalla */}
      <section className="rounded-2xl border border-gray-100 bg-white p-4 sm:p-5 shadow-sm mb-6">
        <div className="px-1 pb-2">
          <h2 className="text-base sm:text-lg font-semibold">
            Calendario semanal
          </h2>
          <p className="text-[11px] sm:text-xs text-gray-500 hidden md:block">
            Visualiza tus franjas de “Abierto” junto a las reservas reales.
          </p>
          <p className="text-[11px] text-gray-500 md:hidden">
            Para ver el calendario detallado es mejor usar el dashboard en una
            pantalla más grande. Abajo tienes el listado de slots que verá el
            bot.
          </p>
        </div>

        <div className="hidden md:block">
          <RBCalendar
            localizer={localizer}
            defaultView={"week"}
            date={weekStart}
            onNavigate={(d: Date) =>
              setCurrentWeek(startOfWeek(d, { weekStartsOn: 1 }))
            }
            min={withHM(new Date(), 6)}
            max={withHM(new Date(), 23)}
            events={events}
            step={30}
            timeslots={2}
            style={{ height: 540, width: "100%" }}
            messages={{
              next: "Sig",
              previous: "Ant",
              today: "Hoy",
              week: "Semana",
              day: "Día",
            }}
            eventPropGetter={(ev: CalEvent) => {
              const kind = (ev as any).resource?.kind;
              if (kind === "OPEN") {
                return {
                  style: {
                    backgroundColor: "rgba(16,185,129,.12)",
                    border: "1px solid rgba(16,185,129,.3)",
                    color: "#065f46",
                    borderRadius: 10,
                  },
                };
              }
              return {
                style: {
                  backgroundColor: "rgba(99,102,241,.18)",
                  border: "1px solid rgba(99,102,241,.35)",
                  borderRadius: 10,
                },
              };
            }}
          />
        </div>
      </section>

      {/* Slots que verá el bot */}
      <section className="rounded-2xl border border-gray-100 bg-white p-4 sm:p-6 shadow-sm">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base sm:text-lg font-semibold">
              Lo que verá el bot — próximos 7 días (30 min)
            </h2>
            <p className="text-[11px] sm:text-xs text-gray-500">
              {offerable.length} slots generados según tus horarios y reservas.
            </p>
          </div>

          {/* Controles de paginación */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[11px] sm:text-xs text-gray-500">
              Por página
            </label>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs sm:text-sm"
            >
              <option value={12}>12</option>
              <option value={24}>24</option>
              <option value={36}>36</option>
              <option value={60}>60</option>
            </select>

            <div className="ml-1 inline-flex items-center rounded-lg border border-gray-200 text-xs sm:text-sm">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 disabled:opacity-40 hover:bg-gray-50"
                aria-label="Página anterior"
              >
                ←
              </button>
              <div className="px-3 py-1.5 text-gray-600">
                {page} / {totalPages}
              </div>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 disabled:opacity-40 hover:bg-gray-50"
                aria-label="Página siguiente"
              >
                →
              </button>
            </div>
          </div>
        </div>

        {/* Grid de slots */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
          {paginated.length === 0 && (
            <div className="col-span-full text-sm text-gray-400">
              No hay slots disponibles con la configuración actual.
            </div>
          )}

          {paginated.map((s, i) => (
            <div
              key={`${s.start.toISOString()}-${i}`}
              className="rounded-xl border border-gray-100 bg-white px-3 py-2 text-xs sm:text-sm shadow-[0_1px_0_rgba(0,0,0,0.03)]"
            >
              <div className="font-medium">
                {format(s.start, "EEE d MMM", { locale: es })}
              </div>
              <div className="text-gray-600">
                {format(s.start, "HH:mm", { locale: es })} –{" "}
                {format(s.end, "HH:mm", { locale: es })}
              </div>
            </div>
          ))}
        </div>

        {/* Pie de paginador */}
        <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between text-[11px] sm:text-xs text-gray-500 gap-1">
          <span>
            Mostrando{" "}
            {offerable.length === 0
              ? 0
              : (page - 1) * pageSize + 1}{" "}
            –
            {Math.min(page * pageSize, offerable.length)} de{" "}
            {offerable.length}
          </span>
          <span>
            Página {page} de {totalPages}
          </span>
        </div>
      </section>
    </div>
  );
}
