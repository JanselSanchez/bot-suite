// utils/wa-server/scheduling-logic.mjs

// ----------------------------------------------------------------------
// 1. HELPERS DE FORMATO Y TIEMPO
// ----------------------------------------------------------------------

function hmsToParts(hms) {
    // Maneja formatos "09:00:00" o "09:00"
    const [h, m] = hms.split(":").map(Number);
    return { h, m };
  }
  
  function pad2(n) {
    return n.toString().padStart(2, "0");
  }
  
  function toHHMM(t) {
    if (!t) return "";
    // Aseguramos que si viene "09:00:00" lo dejemos en "09:00"
    const parts = t.split(":");
    return `${pad2(Number(parts[0]))}:${pad2(Number(parts[1]))}`;
  }
  
  // ----------------------------------------------------------------------
  // 2. CÁLCULO DE VENTANAS ABIERTAS (LÓGICA CORREGIDA)
  // ----------------------------------------------------------------------
  
  /**
   * Recorre los 7 días desde weekStart y busca si hay horario en la DB para ese día.
   * Evita errores matemáticos de "dow" iterando naturalmente sobre el calendario.
   */
  export function weeklyOpenWindows(weekStart, businessHours) {
    const windows = [];
    
    // Clonamos la fecha de inicio para no mutar la original
    // weekStart se asume que es el Lunes de esa semana (00:00 horas)
    let currentDayCursor = new Date(weekStart);
  
    // Iteramos 7 días hacia adelante (Lunes, Martes... Domingo)
    for (let i = 0; i < 7; i++) {
      
      // Obtenemos el día de la semana real de la fecha actual (0=Domingo, 1=Lunes...)
      const currentDow = currentDayCursor.getDay();
  
      // Buscamos si existe una configuración para este día exacto en la DB
      // Coincide con tu columna 'dow' y 'is_closed' de la imagen
      const dayConfig = businessHours.find(
        (bh) => bh.dow === currentDow && bh.is_closed === false
      );
  
      if (dayConfig && dayConfig.open_time && dayConfig.close_time) {
        // Parseamos hora apertura
        const { h: openH, m: openM } = hmsToParts(toHHMM(dayConfig.open_time));
        // Parseamos hora cierre
        const { h: closeH, m: closeM } = hmsToParts(toHHMM(dayConfig.close_time));
  
        // Construimos fecha inicio (Fecha del cursor + Hora DB)
        const start = new Date(currentDayCursor);
        start.setHours(openH, openM, 0, 0);
  
        // Construimos fecha fin
        const end = new Date(currentDayCursor);
        end.setHours(closeH, closeM, 0, 0);
  
        // Validación simple: Si cierra después de abrir, es una ventana válida
        if (end > start) {
          windows.push({ start, end });
        }
      }
  
      // Avanzamos el cursor al siguiente día
      currentDayCursor.setDate(currentDayCursor.getDate() + 1);
    }
  
    return windows;
  }
  
  // ----------------------------------------------------------------------
  // 3. GENERADOR DE SLOTS (EL CORAZÓN DEL SISTEMA)
  // ----------------------------------------------------------------------
  
  /**
   * Toma las ventanas abiertas y "resta" las citas existentes para dejar los huecos.
   */
  export function generateOfferableSlots(
    openWindows, // Array de { start, end } calculado arriba
    bookings,    // Array de citas confirmadas de la DB
    stepMin = 30 // Duración del slot (30 min por defecto)
  ) {
    const slots = [];
  
    for (const window of openWindows) {
      let cursor = new Date(window.start);
      const windowEnd = new Date(window.end);
  
      // Mientras quepa un slot más antes de cerrar...
      while (cursor.getTime() < windowEnd.getTime()) {
        
        // Calculamos el fin de este slot candidato
        const slotEnd = new Date(cursor);
        slotEnd.setMinutes(slotEnd.getMinutes() + stepMin);
  
        // Si el slot se sale del horario de cierre, paramos
        if (slotEnd.getTime() > windowEnd.getTime()) {
          break;
        }
  
        // -----------------------------------------------------------
        // DETECCIÓN DE CHOQUES (COLLISION DETECTION)
        // -----------------------------------------------------------
        // Un slot está ocupado si se solapa con CUALQUIER cita existente
        const isBusy = bookings.some((booking) => {
          const busyStart = new Date(booking.starts_at);
          const busyEnd = new Date(booking.ends_at);
  
          // Fórmula matemática de solapamiento de rangos:
          // (StartA < EndB) AND (EndA > StartB)
          return (cursor.getTime() < busyEnd.getTime()) && 
                 (slotEnd.getTime() > busyStart.getTime());
        });
  
        // Si no está ocupado, lo agregamos a la lista de ofertas
        if (!isBusy) {
          slots.push({
            start: new Date(cursor),
            end: slotEnd,
          });
        }
  
        // Avanzamos el cursor 30 mins para probar el siguiente hueco
        cursor.setMinutes(cursor.getMinutes() + stepMin);
      }
    }
  
    return slots;
  }