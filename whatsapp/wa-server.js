// whatsapp/wa-server.js
require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const express = require("express");
const qrcode = require("qrcode-terminal");
const P = require("pino");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

// Importaciones de Date-fns
const { startOfWeek, addDays, startOfDay } = require("date-fns");

// ---------------------------------------------------------------------
// CONFIGURACIÓN GLOBAL Y VARIABLES DE ENTORNO
// ---------------------------------------------------------------------

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 4001;

// 🔥 AJUSTE DE ZONA HORARIA (CRÍTICO PARA SANTO DOMINGO)
// Render/Railway corren en UTC (0). Santo Domingo es UTC-4.
// Sumamos 4 horas a la hora de la DB para que el servidor entienda la hora real local.
const SERVER_OFFSET_HOURS = 4; 

const logger = P({
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
      ignore: "pid,hostname",
    },
  },
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const sessions = new Map();

// =====================================================================
// 1. LÓGICA DE SCHEDULING (INTEGRADA - NO BORRAR)
// Se integra aquí para evitar errores de importación en producción.
// =====================================================================

function hmsToParts(hms) {
  const [h, m] = hms.split(":").map(Number);
  return { h, m };
}

function pad2(n) {
  return n.toString().padStart(2, "0");
}

function toHHMM(t) {
  if (!t) return "";
  const parts = t.split(":");
  return `${pad2(Number(parts[0]))}:${pad2(Number(parts[1]))}`;
}

/**
 * Convierte el horario de apertura (ej: 09:00:00) en ventanas de tiempo reales para la semana.
 * APLICA LA CORRECCIÓN DE ZONA HORARIA.
 */
function weeklyOpenWindows(weekStart, businessHours) {
  const windows = [];
  
  // weekStart se asume que es el Lunes de esa semana (00:00 horas)
  let currentDayCursor = new Date(weekStart);

  // Iteramos 7 días hacia adelante
  for (let i = 0; i < 7; i++) {
    const currentDow = currentDayCursor.getDay(); // 0=Domingo, 1=Lunes...

    // Buscamos configuración para este día en la DB que NO esté cerrado
    const dayConfig = businessHours.find(
      (bh) => bh.dow === currentDow && bh.is_closed === false
    );

    if (dayConfig && dayConfig.open_time && dayConfig.close_time) {
      const { h: openH, m: openM } = hmsToParts(toHHMM(dayConfig.open_time));
      const { h: closeH, m: closeM } = hmsToParts(toHHMM(dayConfig.close_time));

      // Construimos fecha inicio (Fecha del cursor + Hora DB + OFFSET)
      const start = new Date(currentDayCursor);
      start.setHours(openH + SERVER_OFFSET_HOURS, openM, 0, 0);

      // Construimos fecha fin (Fecha del cursor + Hora DB + OFFSET)
      const end = new Date(currentDayCursor);
      end.setHours(closeH + SERVER_OFFSET_HOURS, closeM, 0, 0);

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

/**
 * Resta las citas (bookings) a las ventanas abiertas para sacar los huecos libres.
 */
function generateOfferableSlots(openWindows, bookings, stepMin = 30) {
  const slots = [];

  for (const window of openWindows) {
    let cursor = new Date(window.start);
    const windowEnd = new Date(window.end);

    while (cursor.getTime() < windowEnd.getTime()) {
      const slotEnd = new Date(cursor);
      slotEnd.setMinutes(slotEnd.getMinutes() + stepMin);

      // Si el slot se sale del horario de cierre, paramos
      if (slotEnd.getTime() > windowEnd.getTime()) {
        break;
      }

      // Verificamos si este hueco choca con alguna reserva existente
      const isBusy = bookings.some((booking) => {
        const busyStart = new Date(booking.starts_at);
        const busyEnd = new Date(booking.ends_at);
        
        // Lógica de colisión: (StartA < EndB) && (EndA > StartB)
        return (cursor.getTime() < busyEnd.getTime()) && 
               (slotEnd.getTime() > busyStart.getTime());
      });

      if (!isBusy) {
        slots.push({
          start: new Date(cursor),
          end: slotEnd,
        });
      }

      // Avanzamos al siguiente slot
      cursor.setMinutes(cursor.getMinutes() + stepMin);
    }
  }

  return slots;
}

// ---------------------------------------------------------------------
// 2. HELPERS: CALENDARIO Y ARCHIVOS (.ICS)
// ---------------------------------------------------------------------

/**
 * Crea un archivo de calendario (.ics) en memoria para activar alarmas
 */
function createICSFile(
  title,
  description,
  location,
  startDate,
  durationMinutes = 60
) {
  const formatTime = (date) =>
    date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const start = new Date(startDate);
  const end = new Date(start.getTime() + durationMinutes * 60000);
  const now = new Date();

  const icsData = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PymeBot//Agendador//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${now.getTime()}@pymebot.com`,
    `DTSTAMP:${formatTime(now)}`,
    `DTSTART:${formatTime(start)}`,
    `DTEND:${formatTime(end)}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Recordatorio de Cita",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  return Buffer.from(icsData);
}

// ---------------------------------------------------------------------
// 3. CEREBRO DEL NEGOCIO & CÁLCULO DE DISPONIBILIDAD
// ---------------------------------------------------------------------

async function getTenantContext(tenantId) {
  try {
    const { data } = await supabase
      .from("tenants")
      .select("name, vertical, description")
      .eq("id", tenantId)
      .maybeSingle();

    if (!data)
      return { name: "el negocio", vertical: "general", description: "" };
    return data;
  } catch (e) {
    return { name: "el negocio", vertical: "general", description: "" };
  }
}

async function getTemplate(tenantId, eventKey) {
  const { data } = await supabase
    .from("message_templates")
    .select("body")
    .eq("tenant_id", tenantId)
    .eq("event", eventKey)
    .eq("active", true)
    .maybeSingle();

  return data?.body || null;
}

function renderTemplate(body, variables = {}) {
  if (!body) return "";
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] || "");
}

/**
 * Obtiene los slots libres de 30 minutos a partir de una fecha de inicio.
 * Esta función es la que el bot usará para agendar.
 */
async function getAvailableSlots(
  tenantId,
  resourceId,
  startDate,
  daysToLookAhead = 7
) {
  if (!tenantId) return [];

  // 1. Obtener la semana de inicio (Lunes = 1)
  const weekStart = startOfWeek(startDate, { weekStartsOn: 1 });
  const weekEnd = addDays(weekStart, daysToLookAhead);

  // 2. Consulta de Horarios (business_hours)
  // 🔥 FIX: Añadido filtro is_closed=false para asegurar que traemos días abiertos
  const { data: hours } = await supabase
    .from("business_hours")
    .select("dow, is_closed, open_time, close_time")
    .eq("tenant_id", tenantId)
    .eq("is_closed", false) 
    .order("dow", { ascending: true });

  // 3. Consulta de Citas (bookings)
  let bookingsQuery = supabase
    .from("bookings")
    .select("starts_at, ends_at, resource_id, status")
    .eq("tenant_id", tenantId)
    .gte("starts_at", startOfDay(startDate).toISOString())
    .lt("ends_at", addDays(weekEnd, 1).toISOString())
    .in("status", ["confirmed", "pending"]);

  // Si se especifica un recurso (barbero), filtramos. Si no, traemos todo.
  if (resourceId) {
    bookingsQuery = bookingsQuery.eq("resource_id", resourceId);
  }
  const { data: bookings } = await bookingsQuery;

  // 4. Aplicar la lógica de cálculo usando funciones INTEGRADS (Locales)
  const openWindows = weeklyOpenWindows(weekStart, hours || []);

  const offerableSlots = generateOfferableSlots(
    openWindows,
    bookings || [],
    30 // Slots de 30 minutos
  );

  // Filtrar slots pasados y devolver
  return offerableSlots.filter((slot) => slot.start >= startDate);
}

// ---------------------------------------------------------------------
// 4. DEFINICIÓN DE TOOLS (HERRAMIENTAS) PARA OPENAI
// ---------------------------------------------------------------------

const tools = [
  {
    type: "function",
    function: {
      name: "check_availability",
      description:
        "Consulta los slots libres. ÚSALA INMEDIATAMENTE si el cliente pide cita o pregunta horarios.",
      parameters: {
        type: "object",
        properties: {
          resourceId: {
            type: "string",
            description: "Opcional. Si el cliente no dice con quién, déjalo vacío.",
          },
          requestedDate: {
            type: "string",
            description:
              "La fecha ISO de inicio. Si el cliente dice 'hoy' o 'mañana', calcula la fecha basada en la fecha actual.",
          },
        },
        required: ["requestedDate"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_booking",
      description:
        "Crea una nueva cita. Si el cliente no eligió barbero, omite el resourceId.",
      parameters: {
        type: "object",
        properties: {
          serviceId: {
            type: "string",
            description: "ID del servicio a agendar (si aplica).",
          },
          resourceId: {
            type: "string",
            description: "ID del recurso/barbero (OPCIONAL).",
          },
          customerName: {
            type: "string",
            description: "Nombre del cliente.",
          },
          phone: {
            type: "string",
            description: "Número de teléfono del cliente.",
          },
          startsAtISO: {
            type: "string",
            description: "Fecha y hora de inicio en formato ISO 8601.",
          },
          endsAtISO: {
            type: "string",
            description: "Fecha y hora de fin en formato ISO 8601.",
          },
          notes: {
            type: "string",
            description: "Notas adicionales para la cita.",
          },
        },
        // 🔥 FIX CRÍTICO: resourceId y customerName ELIMINADOS de required para permitir nulos y auto-completado
        required: [
          "phone",
          "startsAtISO",
          "endsAtISO",
        ],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reschedule_booking",
      description:
        "Actualiza la fecha y hora de una cita ya existente.",
      parameters: {
        type: "object",
        properties: {
          bookingId: {
            type: "string",
            description: "ID de la cita (si se conoce).",
          },
          customerPhone: {
            type: "string",
            description: "Número de teléfono WhatsApp del cliente.",
          },
          oldBookingDate: {
            type: "string",
            description: "Fecha ISO original de la cita antigua.",
          },
          newStartsAtISO: {
            type: "string",
            description: "Nueva fecha y hora de inicio ISO 8601.",
          },
          newEndsAtISO: {
            type: "string",
            description: "Nueva fecha y hora de fin ISO 8601.",
          },
        },
        required: [
          "customerPhone",
          "oldBookingDate",
          "newStartsAtISO",
          "newEndsAtISO",
        ],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_booking",
      description: "Cancela una cita existente.",
      parameters: {
        type: "object",
        properties: {
          customerPhone: {
            type: "string",
            description: "Número de teléfono del cliente.",
          },
          bookingDate: {
            type: "string",
            description: "Fecha de la cita a cancelar (ISO).",
          },
        },
        required: ["customerPhone", "bookingDate"],
      },
    },
  },
];

// ---------------------------------------------------------------------
// 5. IA CON REGLA DE ORO Y MANEJO DE TOOLS
// ---------------------------------------------------------------------

// 🔥 FIX: Aceptamos pushName en los argumentos para el Prompt
async function generateReply(text, tenantId, pushName) {
  const cleanText = text.trim();
  const lower = cleanText.toLowerCase();

  // A) REGLA PRECIOS
  const priceKeywords = ["precio", "costo", "cuanto vale", "planes", "tarifa"];
  if (priceKeywords.some((kw) => lower.includes(kw))) {
    const template = await getTemplate(tenantId, "pricing_pitch");
    if (template) return renderTemplate(template, {});
  }

  // B) IA CONTEXTUAL
  const context = await getTenantContext(tenantId);

  // 🔥 FECHA ACTUAL + PROMPT ANTI-MIEDO
  const now = new Date();
  const currentDateStr = now.toLocaleString("es-DO", {
    timeZone: "America/Santo_Domingo",
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  });

  const systemPrompt = `
    Eres el asistente virtual de "${context.name}".
    Tipo: ${context.vertical}.
    
    DATOS ACTUALES:
    - Fecha y Hora: ${currentDateStr}.
    - Cliente (WhatsApp): "${pushName}".

    TU PERSONALIDAD:
    - Amable, cercana y con un toque dominicano cálido (pero profesional).
    - Saluda por el nombre "${pushName}" si es posible y no lo has hecho.

    ⚠️ INSTRUCCIÓN SUPREMA (ANTI-MIEDO):
    1. ESTÁ PROHIBIDO decir "no puedo agendar" o "llama al local". TU AGENDA ES TUYA.
    2. SIEMPRE usa las herramientas. Si faltan datos, asúmelos (ej: recurso vacío, nombre de WhatsApp) o pregúntalos rápido.

    REGLAS DE ACCIÓN:
    1. Si el cliente dice "Cita hoy a las 3:30":
       - Ejecuta "create_booking" DE INMEDIATO con esa hora.
       - Si no te dieron nombre, usa "${pushName}". NO te detengas.
       - Si no dijo barbero, manda resourceId: null.
    
    2. Si preguntan horarios:
       - Ejecuta "check_availability".
       - Muestra las horas que te devuelva la herramienta.
    
    3. Reagendar/Cancelar:
       - Pide el teléfono si no lo tienes y ejecuta la herramienta.
  `.trim();

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: cleanText },
  ];

  try {
    let completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages,
      tools: tools,
      tool_choice: "auto",
    });

    let message = completion.choices[0].message;

    // Si la IA quiere usar una herramienta
    if (message.tool_calls) {
      messages.push(message);

      for (const toolCall of message.tool_calls) {
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments);
        let functionResponse;

        if (functionName === "check_availability") {
          const slots = await getAvailableSlots(
            tenantId,
            functionArgs.resourceId || null,
            new Date(functionArgs.requestedDate),
            7
          );
          if (slots.length > 0) {
              const formattedSlots = slots.slice(0, 15).map((s) =>
                  s.start.toLocaleString("es-DO", {
                    weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true
                  })
                ).join(", ");
              functionResponse = JSON.stringify({ available_slots: formattedSlots });
          } else {
              functionResponse = JSON.stringify({ available_slots: "No hay horarios disponibles. (Verifica si la tienda cerró)" });
          }
          
        } else if (functionName === "create_booking") {
          
          // 🔥 FIX LÓGICO: ResourceId NULL y Nombre por defecto si faltan
          const finalResourceId = functionArgs.resourceId || null;
          const finalCustomerName = functionArgs.customerName || pushName || "Cliente WhatsApp";

          const { data: booking, error } = await supabase
            .from("bookings")
            .insert([
              {
                tenant_id: tenantId,
                service_id: functionArgs.serviceId || null,
                resource_id: finalResourceId, // Puede ser NULL y la DB lo acepta
                customer_name: finalCustomerName,
                customer_phone: functionArgs.phone,
                starts_at: functionArgs.startsAtISO,
                ends_at: functionArgs.endsAtISO,
                status: "confirmed",
                notes: functionArgs.notes || null,
              },
            ])
            .select("*")
            .single();

          if (!error && booking) {
            functionResponse = JSON.stringify({ success: true, bookingId: booking.id, assignedName: finalCustomerName });
          } else {
            functionResponse = JSON.stringify({ success: false, error: error?.message });
          }

        } else if (functionName === "reschedule_booking" || functionName === "cancel_booking") {
           
           // 🔥 FIX TELÉFONOS: Buscamos el limpio Y el formato whatsapp:+
           const cleanPhone = functionArgs.customerPhone.replace(/\D/g, "");
           const whatsappPhone = `whatsapp:+${cleanPhone}`; 
           
           const query = supabase.from('bookings').select('id')
             .eq('tenant_id', tenantId)
             // Buscamos coincidencia en cualquiera de los formatos para asegurar éxito
             .or(`customer_phone.eq.${functionArgs.customerPhone},customer_phone.eq.${whatsappPhone},customer_phone.eq.${cleanPhone}`)
             .in('status', ['confirmed', 'pending']);
            
          // Filtramos por fecha si viene (para ser precisos)
          if(functionArgs.oldBookingDate) query.eq("starts_at", functionArgs.oldBookingDate);
          if(functionArgs.bookingDate) query.eq("starts_at", functionArgs.bookingDate);

          const { data: targetBooking } = await query.maybeSingle();

          if (targetBooking) {
             let err;
             if (functionName === "cancel_booking") {
                ({ error: err } = await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', targetBooking.id));
             } else {
                ({ error: err } = await supabase.from('bookings').update({ 
                    starts_at: functionArgs.newStartsAtISO, 
                    ends_at: functionArgs.newEndsAtISO 
                }).eq('id', targetBooking.id));
             }
             functionResponse = JSON.stringify({ success: !err });
          } else {
            functionResponse = JSON.stringify({ success: false, error: "No encontré la cita. Verifica el número y la fecha." });
          }
        }

        messages.push({
          tool_call_id: toolCall.id,
          role: "tool",
          name: functionName,
          content: functionResponse,
        });
      }

      // Segunda llamada a OpenAI
      const secondResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: messages,
      });

      return secondResponse.choices[0].message.content.trim();
    }

    return completion.choices[0].message.content.trim();
  } catch (err) {
    logger.error("Error OpenAI:", err);
    return null;
  }
}

// ---------------------------------------------------------------------
// 6. ACTUALIZAR ESTADO DB
// ---------------------------------------------------------------------

async function updateSessionDB(tenantId, updateData) {
  // Siempre incluimos tenant_id para poder usar upsert
  const row = {
    tenant_id: tenantId,
    ...updateData,
  };

  const { error } = await supabase
    .from("whatsapp_sessions")
    .upsert([row], { onConflict: "tenant_id" });

  if (error) {
    console.error("[updateSessionDB] Error upsert whatsapp_sessions:", error);
  }

  if (updateData.status) {
    const isConnected = updateData.status === "connected";
    await supabase
      .from("tenants")
      .update({ wa_connected: isConnected })
      .eq("id", tenantId);
  }
}

// ---------------------------------------------------------------------
// 7. CORE WHATSAPP
// ---------------------------------------------------------------------

async function getOrCreateSession(tenantId) {
  const existing = sessions.get(tenantId);
  if (existing && existing.socket) return existing;

  logger.info({ tenantId }, "🔌 Iniciando Socket...");

  const { default: makeWASocket, DisconnectReason } = await import(
    "@whiskeysockets/baileys"
  );
  const { useSupabaseAuthState } = await import(
    "./utils/wa-server/supabaseAuthState.mjs"
  );
  
  const { state, saveCreds } = await useSupabaseAuthState(supabase, tenantId);

  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ["PymeBot", "Chrome", "1.0.0"],
    syncFullHistory: false,
    connectTimeoutMs: 60000,
  });

  const info = { tenantId, socket: sock, status: "connecting", qr: null };
  sessions.set(tenantId, info);

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      info.status = "qrcode";
      info.qr = qr;
      logger.info({ tenantId }, "✨ QR Generado");
      await updateSessionDB(tenantId, {
        qr_data: qr,
        status: "qrcode",
        last_seen_at: new Date().toISOString(),
      });
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      info.status = "connected";
      info.qr = null;
      logger.info({ tenantId }, "✅ Conectado");
      let phone = sock?.user?.id ? sock.user.id.split(":")[0] : null;
      await updateSessionDB(tenantId, {
        status: "connected",
        qr_data: null,
        phone_number: phone,
        last_connected_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      });
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;
      if (shouldReconnect) {
        sessions.delete(tenantId);
        getOrCreateSession(tenantId);
      } else {
        sessions.delete(tenantId);
        await updateSessionDB(tenantId, {
          status: "disconnected",
          qr_data: null,
          auth_state: null,
        });
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages?.[0];
    if (!msg?.message || msg.key.fromMe) return;
    const remoteJid = msg.key.remoteJid;
    if (remoteJid.includes("@g.us")) return;

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text;
    if (!text) return;

    // 🔥 FIX: Capturamos el nombre real del cliente desde WhatsApp
    const pushName = msg.pushName || "Cliente";

    // 🔥 Pasamos el nombre a la función de respuesta
    const reply = await generateReply(text, tenantId, pushName);
    if (reply) {
      await sock.sendMessage(remoteJid, { text: reply });
    }
  });

  return info;
}

// ---------------------------------------------------------------------
// 8. API ROUTES BÁSICAS
// ---------------------------------------------------------------------

app.get("/health", (req, res) =>
  res.json({ ok: true, active_sessions: sessions.size })
);

app.post("/sessions/:tenantId/connect", async (req, res) => {
  try {
    const info = await getOrCreateSession(req.params.tenantId);
    res.json({ ok: true, status: info.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/sessions/:tenantId/disconnect", async (req, res) => {
  const s = sessions.get(req.params.tenantId);
  if (s?.socket) await s.socket.logout().catch(() => {});
  sessions.delete(req.params.tenantId);
  await updateSessionDB(req.params.tenantId, {
    status: "disconnected",
    qr_data: null,
    auth_state: null,
  });
  res.json({ ok: true });
});

/**
 * 🔥 ENDPOINT MAESTRO: Envía la plantilla Y la alarma
 */
app.post("/sessions/:tenantId/send-template", async (req, res) => {
  const { tenantId } = req.params;
  const { event, phone, variables } = req.body;

  if (!event || !phone)
    return res.status(400).json({ error: "Faltan datos" });

  let session = sessions.get(tenantId);
  if (!session || session.status !== "connected") {
    try {
      session = await getOrCreateSession(tenantId);
    } catch (e) {}
  }

  if (!session || session.status !== "connected") {
    return res.status(400).json({ error: "Bot no conectado." });
  }

  // 1. Obtener la plantilla de texto
  const templateBody = await getTemplate(tenantId, event);
  if (!templateBody) {
    return res
      .status(404)
      .json({ error: `Plantilla no encontrada: ${event}` });
  }

  const message = renderTemplate(templateBody, variables || {});
  const jid = phone.replace(/\D/g, "") + "@s.whatsapp.net";

  try {
    // 2. Enviar el MENSAJE DE TEXTO primero
    await session.socket.sendMessage(jid, { text: message });

    // 3. LÓGICA DE ALARMA: Si es una confirmación de cita, enviamos el .ICS
    if (event === "booking_confirmed" && variables?.date && variables?.time) {
      const context = await getTenantContext(tenantId);

      const dateStr = `${variables.date} ${variables.time}`;
      const appointmentDate = new Date(dateStr);

      if (!isNaN(appointmentDate.getTime())) {
        const icsBuffer = createICSFile(
          `Cita en ${context.name}`,
          `Servicio con ${variables.resource_name || "Nosotros"}.`,
          "En el local",
          appointmentDate
        );

        await session.socket.sendMessage(jid, {
          document: icsBuffer,
          mimetype: "text/calendar",
          fileName: "agendar_cita.ics",
          caption:
            "📅 Toca este archivo para agregar el recordatorio a tu calendario.",
        });
        logger.info({ tenantId }, "📅 Alarma .ics enviada");
      }
    }

    logger.info({ tenantId, event, phone }, "📨 Plantilla enviada");
    res.json({ ok: true, message });
  } catch (e) {
    logger.error(e, "Fallo enviando mensaje");
    res.status(500).json({ error: "Error envío" });
  }
});

// ---------------------------------------------------------------------
// 9. API DE CONSULTA DE DISPONIBILIDAD (TOOL: check_availability)
// ---------------------------------------------------------------------

/**
 * GET /api/v1/availability?tenantId=...&resourceId=...&date=...
 */
app.get("/api/v1/availability", async (req, res) => {
  const { tenantId, resourceId, date } = req.query;

  if (!tenantId || !date) {
    return res.status(400).json({ error: "Faltan tenantId y date" });
  }

  const requestedDate = new Date(String(date));
  if (isNaN(requestedDate.getTime())) {
    return res.status(400).json({ error: "Formato de fecha inválido" });
  }

  const slots = await getAvailableSlots(
    String(tenantId),
    resourceId ? String(resourceId) : null,
    requestedDate,
    7
  );

  const formattedSlots = slots.map(
    (s) =>
      `${s.start.toLocaleString("es-DO", {
        weekday: "short",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })}`
  );

  res.json({
    ok: true,
    available_slots_count: slots.length,
    available_slots: formattedSlots.slice(0, 40),
  });
});

// ---------------------------------------------------------------------
// 10. API DE CREACIÓN DE CITA (TOOL: create_booking)
// ---------------------------------------------------------------------

/**
 * Tool: create_booking
 *
 * POST /api/v1/create-booking
 */
app.post("/api/v1/create-booking", async (req, res) => {
  const {
    tenantId,
    serviceId,
    resourceId,
    customerName,
    phone,
    startsAtISO,
    endsAtISO,
    notes,
    extraVariables,
  } = req.body || {};

  if (
    !tenantId ||
    // resourceId ya no es requerido
    !phone ||
    !startsAtISO ||
    !endsAtISO
  ) {
    return res.status(400).json({
      ok: false,
      error: "missing_fields",
      detail:
        "Requiere tenantId, phone, startsAtISO y endsAtISO. CustomerName es opcional.",
    });
  }

  const finalName = customerName || "Cliente Web";

  // 1. Crear la cita en la base de datos
  const { data: booking, error } = await supabase
    .from("bookings")
    .insert([
      {
        tenant_id: tenantId,
        service_id: serviceId || null,
        resource_id: resourceId || null, // Auto-asignación
        customer_name: finalName,
        customer_phone: phone,
        starts_at: startsAtISO,
        ends_at: endsAtISO,
        status: "confirmed",
        notes: notes || null,
      },
    ])
    .select("*")
    .maybeSingle();

  if (error) {
    logger.error(error, "Error creando booking");
    return res.status(500).json({ ok: false, error: "db_error" });
  }

  if (!booking) {
    return res.status(500).json({ ok: false, error: "no_booking_created" });
  }

  // 2. Intentar enviar WhatsApp de confirmación
  try {
    const session = await getOrCreateSession(tenantId);
    if (session && session.status === "connected") {
      const context = await getTenantContext(tenantId);

      const jid = String(phone).replace(/\D/g, "") + "@s.whatsapp.net";

      const startsDate = new Date(startsAtISO);
      const dateStr = startsDate.toISOString().slice(0, 10); // YYYY-MM-DD
      const timeStr = startsDate.toTimeString().slice(0, 5); // HH:MM

      const templateBody = await getTemplate(tenantId, "booking_confirmed");

      const vars = {
        date: dateStr,
        time: timeStr,
        business_name: context.name,
        customer_name: finalName,
        resource_name: booking.resource_name || "",
        ...(extraVariables || {}),
      };

      if (templateBody) {
        const msg = renderTemplate(templateBody, vars);
        await session.socket.sendMessage(jid, { text: msg });
      }

      const icsBuffer = createICSFile(
        `Cita en ${context.name}`,
        `Tu cita está agendada para ${dateStr} a las ${timeStr}.`,
        "En el local",
        startsDate
      );

      await session.socket.sendMessage(jid, {
        document: icsBuffer,
        mimetype: "text/calendar",
        fileName: "cita_confirmada.ics",
        caption:
          "📅 Tu cita fue agendada. Toca este archivo para agregar el recordatorio a tu calendario.",
      });

      logger.info(
        { tenantId, bookingId: booking.id },
        "✅ Booking creado y mensaje enviado"
      );
    } else {
      logger.warn(
        { tenantId, bookingId: booking.id },
        "Booking creado pero bot no conectado"
      );
    }
  } catch (e) {
    logger.error(e, "Error enviando confirmación de creación de cita");
  }

  return res.json({
    ok: true,
    booking: {
      id: booking.id,
      starts_at: booking.starts_at,
      ends_at: booking.ends_at,
      status: booking.status,
    },
  });
});

// ---------------------------------------------------------------------
// 11. API DE REAGENDAMIENTO (TOOL: reschedule_booking)
// ---------------------------------------------------------------------

/**
 * Tool: reschedule_booking
 *
 * POST /api/v1/reschedule-booking
 */
app.post("/api/v1/reschedule-booking", async (req, res) => {
  const {
    tenantId,
    bookingId,
    newStartsAtISO,
    newEndsAtISO,
    extraVariables,
  } = req.body || {};

  if (!tenantId || !bookingId || !newStartsAtISO || !newEndsAtISO) {
    return res.status(400).json({
      ok: false,
      error: "missing_fields",
      detail:
        "Requiere tenantId, bookingId, newStartsAtISO y newEndsAtISO en el body.",
    });
  }

  const { data: updatedBooking, error } = await supabase
    .from("bookings")
    .update({
      starts_at: newStartsAtISO,
      ends_at: newEndsAtISO,
      status: "confirmed",
    })
    .eq("id", bookingId)
    .eq("tenant_id", tenantId)
    .select("*")
    .maybeSingle();

  if (error) {
    logger.error(error, "Error reagendando booking");
    return res.status(500).json({ ok: false, error: "db_error" });
  }

  if (!updatedBooking) {
    return res
      .status(404)
      .json({ ok: false, error: "booking_not_found_or_not_owned" });
  }

  // 2. Intentar enviar WhatsApp de confirmación de reagendamiento
  try {
    const session = await getOrCreateSession(tenantId);
    if (session && session.status === "connected") {
      const context = await getTenantContext(tenantId);

      const phone =
        updatedBooking.customer_phone ||
        updatedBooking.phone ||
        updatedBooking.client_phone ||
        null;

      if (phone) {
        const jid = String(phone).replace(/\D/g, "") + "@s.whatsapp.net";

        const startsDate = new Date(newStartsAtISO);
        const dateStr = startsDate.toISOString().slice(0, 10);
        const timeStr = startsDate.toTimeString().slice(0, 5);

        const templateBody = await getTemplate(
          tenantId,
          "booking_rescheduled"
        );

        const vars = {
          date: dateStr,
          time: timeStr,
          business_name: context.name,
          customer_name: updatedBooking.customer_name || "",
          resource_name: updatedBooking.resource_name || "",
          ...(extraVariables || {}),
        };

        if (templateBody) {
          const msg = renderTemplate(templateBody, vars);
          await session.socket.sendMessage(jid, { text: msg });
        }

        const icsBuffer = createICSFile(
          `Cita reagendada en ${context.name}`,
          `Tu cita fue reagendada para ${dateStr} a las ${timeStr}.`,
          "En el local",
          startsDate
        );

        await session.socket.sendMessage(jid, {
          document: icsBuffer,
          mimetype: "text/calendar",
          fileName: "cita_reagendada.ics",
          caption:
            "📅 Tu cita fue reagendada. Toca este archivo para actualizar el recordatorio en tu calendario.",
        });

        logger.info(
          { tenantId, bookingId },
          "✅ Booking reagendado y mensaje enviado"
        );
      } else {
        logger.warn(
          { tenantId, bookingId },
          "Booking reagendado pero sin teléfono para notificar"
        );
      }
    } else {
      logger.warn(
        { tenantId, bookingId },
        "Booking reagendado pero bot no conectado"
      );
    }
  } catch (e) {
    logger.error(e, "Error enviando confirmación de reagendamiento");
  }

  return res.json({
    ok: true,
    booking: {
      id: updatedBooking.id,
      starts_at: updatedBooking.starts_at,
      ends_at: updatedBooking.ends_at,
      status: updatedBooking.status,
    },
  });
});

// ---------------------------------------------------------------------
// 12. API DE CANCELACIÓN (TOOL: cancel_booking)
// ---------------------------------------------------------------------

/**
 * Tool: cancel_booking
 *
 * POST /api/v1/cancel-booking
 */
app.post("/api/v1/cancel-booking", async (req, res) => {
  const { tenantId, bookingId, extraVariables } = req.body || {};

  if (!tenantId || !bookingId) {
    return res.status(400).json({
      ok: false,
      error: "missing_fields",
      detail: "Requiere tenantId y bookingId en el body.",
    });
  }

  const { data: cancelledBooking, error } = await supabase
    .from("bookings")
    .update({
      status: "cancelled",
    })
    .eq("id", bookingId)
    .eq("tenant_id", tenantId)
    .select("*")
    .maybeSingle();

  if (error) {
    logger.error(error, "Error cancelando booking");
    return res.status(500).json({ ok: false, error: "db_error" });
  }

  if (!cancelledBooking) {
    return res
      .status(404)
      .json({ ok: false, error: "booking_not_found_or_not_owned" });
  }

  // 2. Intentar enviar WhatsApp de confirmación de cancelación
  try {
    const session = await getOrCreateSession(tenantId);
    if (session && session.status === "connected") {
      const context = await getTenantContext(tenantId);

      const phone =
        cancelledBooking.customer_phone ||
        cancelledBooking.phone ||
        cancelledBooking.client_phone ||
        null;

      if (phone) {
        const jid = String(phone).replace(/\D/g, "") + "@s.whatsapp.net";

        const startsDate = new Date(cancelledBooking.starts_at);
        const dateStr = startsDate.toISOString().slice(0, 10);
        const timeStr = startsDate.toTimeString().slice(0, 5);

        const templateBody = await getTemplate(tenantId, "booking_cancelled");

        const vars = {
          date: dateStr,
          time: timeStr,
          business_name: context.name,
          customer_name: cancelledBooking.customer_name || "",
          resource_name: cancelledBooking.resource_name || "",
          ...(extraVariables || {}),
        };

        let msg = "";
        if (templateBody) {
          msg = renderTemplate(templateBody, vars);
        } else {
          msg = `Tu cita en ${context.name} para el ${dateStr} a las ${timeStr} ha sido cancelada exitosamente.`;
        }

        await session.socket.sendMessage(jid, { text: msg });

        logger.info(
          { tenantId, bookingId },
          "✅ Booking cancelado y mensaje enviado"
        );
      } else {
        logger.warn(
          { tenantId, bookingId },
          "Booking cancelado pero sin teléfono para notificar"
        );
      }
    } else {
      logger.warn(
        { tenantId, bookingId },
        "Booking cancelado pero bot no conectado"
      );
    }
  } catch (e) {
    logger.error(e, "Error enviando confirmación de cancelación");
  }

  return res.json({
    ok: true,
    booking: {
      id: cancelledBooking.id,
      status: cancelledBooking.status,
    },
  });
});

// ---------------------------------------------------------------------
// 13. AUTO-RECONEXIÓN (restoreSessions)
// ---------------------------------------------------------------------

// 🔥 RECUPERADA: Lógica para reconectar al reiniciar el server
async function restoreSessions() {
  try {
    logger.info("♻️ Restaurando sesiones de WhatsApp desde la base de datos…");

    const { data, error } = await supabase
      .from("whatsapp_sessions")
      .select("tenant_id, status")
      .in("status", ["connected", "qrcode", "connecting"]);

    if (error) {
      logger.error(error, "Error al cargar sesiones para restoreSessions");
      return;
    }

    if (!data || data.length === 0) {
      logger.info("No hay sesiones previas que restaurar.");
      return;
    }

    for (const row of data) {
      const tenantId = row.tenant_id;
      try {
        logger.info({ tenantId }, "🔄 Restaurando sesión previa…");
        await getOrCreateSession(tenantId);
        await updateSessionDB(tenantId, {
          last_seen_at: new Date().toISOString(),
        });
      } catch (err) {
        logger.error(
          { tenantId, err },
          "Error restaurando sesión de WhatsApp"
        );
      }
    }
  } catch (e) {
    logger.error(e, "Fallo general en restoreSessions");
  }
}

// ---------------------------------------------------------------------
// 14. START SERVER
// ---------------------------------------------------------------------

app.listen(PORT, () => {
  logger.info(`🚀 WA server escuchando en puerto ${PORT}`);
  // Ejecutamos la restauración al levantar
  restoreSessions().catch((e) =>
    logger.error(e, "Error al intentar restaurar sesiones al inicio")
  );
});
