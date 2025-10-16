// worker/utils/dates.ts
// Utilidades de fecha sin dependencias externas

// normaliza: minúsculas, sin tildes; repara "ma�ana" -> "manana"
function norm(input: string) {
    return String(input || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // quita tildes/ñ -> n
      .replace(/\uFFFD/g, "n") // repara replacement char
      .trim();
  }
  
  export function addMinutes(d: Date, mins: number) {
    return new Date(d.getTime() + mins * 60_000);
  }
  
  export function startOfDay(d: Date) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  
  function addDays(d: Date, days: number) {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    return x;
  }
  
  // Devuelve Date al inicio del día local (00:00 local)
  function startOfLocalDay(date: Date) {
    return startOfDay(date);
  }
  
  /**
   * Entiende:
   * - "hoy", "mañana"/"manana", "pasado mañana"/"pasado manana"
   * - "dd/mm/yyyy", "yyyy-mm-dd"
   * - nombres de día (domingo..sabado) => próximo que ocurra
   */
  export function parseDayLabel(input: string): Date | null {
    const t = norm(input);
    if (!t) return null;
  
    if (t === "hoy") return startOfLocalDay(new Date());
    if (t === "manana") return startOfLocalDay(addDays(new Date(), 1));
    if (t === "pasado manana" || t === "pasadomanana") {
      return startOfLocalDay(addDays(new Date(), 2));
    }
  
    // dd/mm/yyyy o dd-mm-yyyy o dd.mm.yyyy
    let m = t.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
    if (m) {
      const d = Number(m[1]), mm = Number(m[2]), y = Number(m[3]);
      const dt = new Date(y, mm - 1, d, 0, 0, 0, 0);
      return isNaN(+dt) ? null : startOfLocalDay(dt);
    }
  
    // yyyy-mm-dd o yyyy/mm/dd o yyyy.mm.dd
    m = t.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
    if (m) {
      const y = Number(m[1]), mm = Number(m[2]), d = Number(m[3]);
      const dt = new Date(y, mm - 1, d, 0, 0, 0, 0);
      return isNaN(+dt) ? null : startOfLocalDay(dt);
    }
  
    const dias = ["domingo","lunes","martes","miercoles","jueves","viernes","sabado"];
    const idx = dias.indexOf(t);
    if (idx !== -1) {
      const now = new Date();
      const todayIdx = now.getDay(); // 0..6
      let diff = idx - todayIdx;
      if (diff <= 0) diff += 7;
      return startOfLocalDay(addDays(new Date(), diff));
    }
  
    return null;
  }
  
  export function formatHour(d: Date) {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  