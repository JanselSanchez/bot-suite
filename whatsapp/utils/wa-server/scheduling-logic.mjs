// wa-server/scheduling-logic.mjs

// 1. Helpers de tiempo y fechas (Necesarios para todas las funciones)
function hmsToParts(hms) {
    const [h, m] = hms.split(":").map(Number);
    return { h, m };
}

function pad2(n) { return n.toString().padStart(2, "0"); }

function toHHMM(t) {
    if (!t) return "";
    const [h, m] = t.split(":");
    return `${pad2(Number(h))}:${pad2(Number(m))}`;
}

// 2. Construye el objeto Date para un día específico de la semana
export function buildDateOnWeek(weekStart, dow, hms) {
    const { h, m } = hmsToParts(hms);
    const d = new Date(weekStart);
    // Añadir días a la fecha base (Lunes de la semana)
    d.setDate(d.getDate() + dow);
    const base = new Date(d);
    base.setHours(h, m, 0, 0);
    return base;
}

// 3. Obtiene las ventanas de horario abierto (Maneja el cruce de medianoche)
export function weeklyOpenWindows(weekStart, businessHours) {
    const out = [];
    for (const d of businessHours) {
        if (d.is_closed || !d.open_time || !d.close_time) continue;
        
        // Suponemos que los datos de DB vienen con dow (0=Dom, 1=Lun...)
        const open = buildDateOnWeek(weekStart, d.dow, toHHMM(d.open_time));
        const close = buildDateOnWeek(weekStart, d.dow, toHHMM(d.close_time));
        
        if (+close <= +open) {
            // Caso 1: Cruce de medianoche (ej: 22:00 a 02:00)
            const end1 = new Date(open); end1.setHours(23, 59, 0, 0);
            out.push({ start: open, end: end1 });
            const start2 = new Date(open); start2.setDate(start2.getDate() + 1); start2.setHours(0, 0, 0, 0);
            out.push({ start: start2, end: close });
        } else {
            // Caso 2: Horario normal (ej: 09:00 a 18:00)
            out.push({ start: open, end: close });
        }
    }
    return out;
}

// 4. Genera slots libres de 30 min (El corazón del algoritmo)
export function generateOfferableSlots(
    windows, // Horarios abiertos (ej: 09:00 - 18:00)
    bookings, // Citas ya tomadas
    stepMin = 30 // Paso de cita
) {
    const slots = [];
    for (const w of windows) {
        const cursor = new Date(w.start);
        while (+cursor < +w.end) {
            const end = new Date(cursor);
            end.setMinutes(end.getMinutes() + stepMin);
            
            if (+end > +w.end) break;
            
            // Revisa si el nuevo slot choca con alguna reserva existente
            const clash = bookings.some((b) => {
                const bs = new Date(b.starts_at);
                const be = new Date(b.ends_at);
                // Un choque ocurre si el nuevo slot empieza antes de que termine la reserva
                // Y termina después de que empieza la reserva.
                return +bs < +end && +be > +cursor;
            });
            
            if (!clash) slots.push({ start: new Date(cursor), end });
            
            cursor.setMinutes(cursor.getMinutes() + stepMin);
        }
    }
    return slots;
}