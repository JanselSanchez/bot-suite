require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const express = require("express");
const qrcode = require("qrcode-terminal");
const P = require("pino");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");
// Asegúrate de tener date-fns instalado
const { startOfWeek, addDays, startOfDay } = require("date-fns");

// ---------------------------------------------------------------------
// CONFIGURACIÓN GLOBAL
// ---------------------------------------------------------------------

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 4001;

// AJUSTE DE ZONA HORARIA (CRÍTICO)
// Render está en UTC (0). Santo Domingo está en UTC-4.
// Sumamos 4 horas a la hora de apertura de la DB para que el servidor entienda cuándo abre realmente.
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
// 1. LÓGICA MATEMÁTICA DE HORARIOS (INTEGRADA - NO BORRAR)
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
 * Calcula las ventanas abiertas basándose en Business Hours y ajustando la zona horaria.
 */
function weeklyOpenWindows(weekStart, businessHours) {
  const windows = [];
  let currentDayCursor = new Date(weekStart);

  // Iteramos 7 días
  for (let i = 0; i < 7; i++) {
    const currentDow = currentDayCursor.getDay(); // 0=Dom, 1=Lun...
    
    // Buscamos configuración para este día que NO esté cerrado
    const dayConfig = businessHours.find(
      (bh) => bh.dow === currentDow && bh.is_closed === false
    );

    if (dayConfig && dayConfig.open_time && dayConfig.close_time) {
      const { h: openH, m: openM } = hmsToParts(toHHMM(dayConfig.open_time));
      const { h: closeH, m: closeM } = hmsToParts(toHHMM(dayConfig.close_time));

      // 🔥 CORRECCIÓN UTC: Sumamos el offset a la hora de apertura/cierre
      const start = new Date(currentDayCursor);
      start.setHours(openH + SERVER_OFFSET_HOURS, openM, 0, 0);

      const end = new Date(currentDayCursor);
      end.setHours(closeH + SERVER_OFFSET_HOURS, closeM, 0, 0);

      // Si la ventana es válida (cierra después de abrir), la guardamos
      if (end > start) {
        windows.push({ start, end });
      }
    }
    // Avanzamos al siguiente día
    currentDayCursor.setDate(currentDayCursor.getDate() + 1);
  }
  return windows;
}

/**
 * Resta las citas ocupadas a las ventanas abiertas.
 */
function generateOfferableSlots(openWindows, bookings, stepMin = 30) {
  const slots = [];
  for (const window of openWindows) {
    let cursor = new Date(window.start);
    const windowEnd = new Date(window.end);

    while (cursor.getTime() < windowEnd.getTime()) {
      const slotEnd = new Date(cursor);
      slotEnd.setMinutes(slotEnd.getMinutes() + stepMin);

      // Si el slot se sale del cierre, paramos
      if (slotEnd.getTime() > windowEnd.getTime()) break;

      // Detectar colisiones con citas existentes
      const isBusy = bookings.some((booking) => {
        const busyStart = new Date(booking.starts_at);
        const busyEnd = new Date(booking.ends_at);
        // Lógica de solapamiento
        return (cursor.getTime() < busyEnd.getTime()) && (slotEnd.getTime() > busyStart.getTime());
      });

      if (!isBusy) {
        slots.push({ start: new Date(cursor), end: slotEnd });
      }
      
      // Avanzamos al siguiente bloque
      cursor.setMinutes(cursor.getMinutes() + stepMin);
    }
  }
  return slots;
}

// =====================================================================
// 2. HELPERS: CALENDARIO (.ICS)
// =====================================================================

function createICSFile(title, description, location, startDate, durationMinutes = 60) {
  const formatTime = (date) => date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const start = new Date(startDate);
  const end = new Date(start.getTime() + durationMinutes * 60000);
  const now = new Date();

  const icsData = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PymeBot//Agendador//ES",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:${now.getTime()}@pymebot.com`, `DTSTAMP:${formatTime(now)}`,
    `DTSTART:${formatTime(start)}`, `DTEND:${formatTime(end)}`,
    `SUMMARY:${title}`, `DESCRIPTION:${description}`, `LOCATION:${location}`,
    "STATUS:CONFIRMED", "BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY",
    "DESCRIPTION:Recordatorio de Cita", "END:VALARM", "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");

  return Buffer.from(icsData);
}

// =====================================================================
// 3. DATOS Y CONSULTAS A DB
// =====================================================================

async function getTenantContext(tenantId) {
  try {
    const { data } = await supabase.from("tenants").select("name, vertical, description").eq("id", tenantId).maybeSingle();
    return data || { name: "el negocio", vertical: "general", description: "" };
  } catch (e) { return { name: "el negocio", vertical: "general", description: "" }; }
}

async function getTemplate(tenantId, eventKey) {
  const { data } = await supabase.from("message_templates").select("body").eq("tenant_id", tenantId).eq("event", eventKey).eq("active", true).maybeSingle();
  return data?.body || null;
}

function renderTemplate(body, variables = {}) {
  if (!body) return "";
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] || "");
}

/**
 * Función principal que usa la lógica integrada para buscar disponibilidad
 */
async function getAvailableSlots(tenantId, resourceId, startDate, daysToLookAhead = 7) {
  if (!tenantId) return [];

  const weekStart = startOfWeek(startDate, { weekStartsOn: 1 });
  const weekEnd = addDays(weekStart, daysToLookAhead);

  // 1. Horarios (Filtrando días cerrados para optimizar)
  const { data: hours } = await supabase
    .from("business_hours")
    .select("dow, is_closed, open_time, close_time")
    .eq("tenant_id", tenantId)
    .eq("is_closed", false) // Solo días abiertos
    .order("dow", { ascending: true });

  // 2. Citas existentes
  let bookingsQuery = supabase
    .from("bookings")
    .select("starts_at, ends_at, resource_id, status")
    .eq("tenant_id", tenantId)
    .gte("starts_at", startOfDay(startDate).toISOString())
    .lt("ends_at", addDays(weekEnd, 1).toISOString())
    .in("status", ["confirmed", "pending"]);

  if (resourceId) bookingsQuery = bookingsQuery.eq("resource_id", resourceId);
  
  const { data: bookings } = await bookingsQuery;

  // 3. Calcular disponibilidad (Usando las funciones locales, NO importadas)
  const openWindows = weeklyOpenWindows(weekStart, hours || []);
  const offerableSlots = generateOfferableSlots(openWindows, bookings || [], 30);

  // Filtrar slots que ya pasaron
  return offerableSlots.filter((slot) => slot.start >= startDate);
}

// =====================================================================
// 4. TOOLS (HERRAMIENTAS PARA LA IA - CONFIGURACIÓN FINAL)
// =====================================================================

const tools = [
  {
    type: "function",
    function: {
      name: "check_availability",
      description: "Consulta horarios disponibles. ÚSALA SIEMPRE que pidan cita.",
      parameters: {
        type: "object",
        properties: {
          resourceId: { type: "string", description: "Opcional." },
          requestedDate: { type: "string", description: "Fecha ISO (YYYY-MM-DD)." },
        },
        required: ["requestedDate"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_booking",
      description: "Crea la cita. El resourceId y el customerName NO son obligatorios.",
      parameters: {
        type: "object",
        properties: {
          serviceId: { type: "string" },
          resourceId: { type: "string" },
          customerName: { type: "string", description: "Nombre del cliente." },
          phone: { type: "string" },
          startsAtISO: { type: "string" },
          endsAtISO: { type: "string" },
          notes: { type: "string" },
        },
        // 🔥 CORRECCIÓN: 'customerName' y 'resourceId' ELIMINADOS de required para evitar bloqueos
        required: ["phone", "startsAtISO", "endsAtISO"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reschedule_booking",
      description: "Mueve una cita.",
      parameters: {
        type: "object",
        properties: {
          customerPhone: { type: "string" },
          oldBookingDate: { type: "string" },
          newStartsAtISO: { type: "string" },
          newEndsAtISO: { type: "string" },
        },
        required: ["customerPhone", "oldBookingDate", "newStartsAtISO", "newEndsAtISO"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_booking",
      description: "Cancela una cita.",
      parameters: {
        type: "object",
        properties: {
          customerPhone: { type: "string" },
          bookingDate: { type: "string" },
        },
        required: ["customerPhone", "bookingDate"],
      },
    },
  },
];

// =====================================================================
// 5. INTELIGENCIA ARTIFICIAL (CONTROLADOR DE MENSAJES)
// =====================================================================

// 🔥 FIX: Aceptamos pushName en los argumentos para el saludo
async function generateReply(text, tenantId, pushName) {
  const cleanText = text.trim();
  const lower = cleanText.toLowerCase();

  // A) Precios
  const priceKeywords = ["precio", "costo", "cuanto vale", "planes", "tarifa"];
  if (priceKeywords.some((kw) => lower.includes(kw))) {
    const template = await getTemplate(tenantId, "pricing_pitch");
    if (template) return renderTemplate(template, {});
  }

  // B) Contexto
  const context = await getTenantContext(tenantId);
  const now = new Date();
  const currentDateStr = now.toLocaleString("es-DO", {
    timeZone: "America/Santo_Domingo",
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  });

  const systemPrompt = `
    Eres el asistente de "${context.name}".
    FECHA ACTUAL: ${currentDateStr}.
    CLIENTE: "${pushName}".

    ⛔ INSTRUCCIÓN SUPREMA (ANTI-MIEDO):
    1. ESTÁ PROHIBIDO decir "no puedo agendar" o "llama al local". TIENES EL CONTROL TOTAL.
    2. SIEMPRE usa las herramientas. Si faltan datos (como el nombre), usa el de WhatsApp o pregunta después.

    REGLAS:
    1. Si piden cita: Ejecuta "create_booking". Si no te dieron nombre, usa "${pushName}". NO TE DETENGAS.
    2. Si piden horario: Ejecuta "check_availability".
    3. Si no dicen barbero: Manda resourceId: null.
    4. Reagendar/Cancelar: Pide el teléfono si no lo tienes.
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
        const args = JSON.parse(toolCall.function.arguments);
        let functionResponse;

        if (functionName === "check_availability") {
          const slots = await getAvailableSlots(tenantId, args.resourceId || null, new Date(args.requestedDate), 7);
          if (slots.length > 0) {
             const list = slots.slice(0, 15).map(s => s.start.toLocaleString("es-DO", { hour:'2-digit', minute:'2-digit', hour12:true })).join(", ");
             functionResponse = JSON.stringify({ available_slots: list });
          } else {
             functionResponse = JSON.stringify({ available_slots: "No hay huecos disponibles. Revisa si la tienda está abierta." });
          }
        } 
        else if (functionName === "create_booking") {
          // 🔥 AUTO-COMPLETADO DE NOMBRE: Si el usuario no lo dijo, usamos pushName
          const finalName = args.customerName || pushName || "Cliente WhatsApp";
          const finalResourceId = args.resourceId || null;

          const { data: booking, error } = await supabase.from("bookings").insert([{
              tenant_id: tenantId,
              resource_id: finalResourceId, 
              customer_name: finalName,
              customer_phone: args.phone,
              starts_at: args.startsAtISO,
              ends_at: args.endsAtISO,
              status: "confirmed",
              notes: args.notes || null
          }]).select().single();

          if (booking) functionResponse = JSON.stringify({ success: true, bookingId: booking.id, note: `Agendado a nombre de ${finalName}` });
          else functionResponse = JSON.stringify({ success: false, error: error?.message });
        }
        else if (functionName === "reschedule_booking" || functionName === "cancel_booking") {
           // 🔥 BÚSQUEDA INTELIGENTE DE TELÉFONO (Con o sin +)
           const clean = args.customerPhone.replace(/\D/g, "");
           const wa = `whatsapp:+${clean}`;
           const query = supabase.from('bookings').select('id').eq('tenant_id', tenantId)
             .or(`customer_phone.eq.${args.customerPhone},customer_phone.eq.${wa},customer_phone.eq.${clean}`)
             .in('status', ['confirmed', 'pending']);
           
           if(args.oldBookingDate) query.eq('starts_at', args.oldBookingDate);
           if(args.bookingDate) query.eq('starts_at', args.bookingDate);

           const { data: target } = await query.maybeSingle();

           if(target) {
              let err;
              if(functionName === "cancel_booking") ({ error: err } = await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', target.id));
              else ({ error: err } = await supabase.from('bookings').update({ starts_at: args.newStartsAtISO, ends_at: args.newEndsAtISO }).eq('id', target.id));
              functionResponse = JSON.stringify({ success: !err });
           } else {
              functionResponse = JSON.stringify({ success: false, error: "Cita no encontrada. Verifica el número." });
           }
        }

        messages.push({ tool_call_id: toolCall.id, role: "tool", name: functionName, content: functionResponse });
      }

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

// =====================================================================
// 6. GESTIÓN DE SESIONES Y SOCKET
// =====================================================================

async function updateSessionDB(tenantId, updateData) {
  await supabase.from("whatsapp_sessions").upsert([{ tenant_id: tenantId, ...updateData }], { onConflict: "tenant_id" });
  if (updateData.status) await supabase.from("tenants").update({ wa_connected: updateData.status === "connected" }).eq("id", tenantId);
}

async function getOrCreateSession(tenantId) {
  const existing = sessions.get(tenantId);
  if (existing && existing.socket) return existing;

  logger.info({ tenantId }, "🔌 Iniciando Socket...");
  const { default: makeWASocket, DisconnectReason } = await import("@whiskeysockets/baileys");
  const { useSupabaseAuthState } = await import("./utils/wa-server/supabaseAuthState.mjs");
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
      await updateSessionDB(tenantId, { qr_data: qr, status: "qrcode", last_seen_at: new Date().toISOString() });
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") {
      info.status = "connected";
      logger.info({ tenantId }, "✅ Conectado");
      let phone = sock?.user?.id ? sock.user.id.split(":")[0] : null;
      await updateSessionDB(tenantId, { status: "connected", qr_data: null, phone_number: phone, last_connected_at: new Date().toISOString() });
    }
    if (connection === "close") {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        sessions.delete(tenantId);
        getOrCreateSession(tenantId);
      } else {
        sessions.delete(tenantId);
        await updateSessionDB(tenantId, { status: "disconnected", qr_data: null, auth_state: null });
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages?.[0];
    if (!msg?.message || msg.key.fromMe) return;
    const remoteJid = msg.key.remoteJid;
    if (remoteJid.includes("@g.us")) return;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
    if (!text) return;

    // 🔥 FIX: Capturar nombre del cliente (PushName) para el prompt
    const pushName = msg.pushName || "Cliente";
    
    // 🔥 Pasar nombre a la función
    const reply = await generateReply(text, tenantId, pushName);
    if (reply) await sock.sendMessage(remoteJid, { text: reply });
  });

  return info;
}

// =====================================================================
// 7. ENDPOINTS (TODOS LOS ORIGINALES)
// =====================================================================

app.get("/health", (req, res) => res.json({ ok: true, active_sessions: sessions.size }));

app.post("/sessions/:tenantId/connect", async (req, res) => {
  try {
    const info = await getOrCreateSession(req.params.tenantId);
    res.json({ ok: true, status: info.status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/sessions/:tenantId/disconnect", async (req, res) => {
  const s = sessions.get(req.params.tenantId);
  if (s?.socket) await s.socket.logout().catch(() => {});
  sessions.delete(req.params.tenantId);
  await updateSessionDB(req.params.tenantId, { status: "disconnected", qr_data: null, auth_state: null });
  res.json({ ok: true });
});

app.post("/sessions/:tenantId/send-template", async (req, res) => {
  const { tenantId } = req.params;
  const { event, phone, variables } = req.body;
  
  let session = sessions.get(tenantId);
  if (!session || session.status !== "connected") {
     try { session = await getOrCreateSession(tenantId); } catch (e) {}
  }
  if (!session || session.status !== "connected") return res.status(400).json({ error: "Bot no conectado." });

  const templateBody = await getTemplate(tenantId, event);
  if (!templateBody) return res.status(404).json({ error: "Template missing" });

  const message = renderTemplate(templateBody, variables || {});
  const jid = phone.replace(/\D/g, "") + "@s.whatsapp.net";

  try {
    await session.socket.sendMessage(jid, { text: message });
    if (event === "booking_confirmed" && variables?.date && variables?.time) {
       const dateStr = `${variables.date} ${variables.time}`;
       const icsBuffer = createICSFile("Cita", "Tu cita en la barbería", "Local", new Date(dateStr));
       await session.socket.sendMessage(jid, { document: icsBuffer, mimetype: "text/calendar", fileName: "cita.ics", caption: "📅 Agendar" });
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: "Error envío" }); }
});

app.get("/api/v1/availability", async (req, res) => {
  const { tenantId, resourceId, date } = req.query;
  if (!tenantId || !date) return res.status(400).json({ error: "Faltan datos" });
  const slots = await getAvailableSlots(String(tenantId), resourceId || null, new Date(String(date)), 7);
  res.json({ ok: true, available_slots: slots.map(s => s.start.toISOString()) });
});

app.post("/api/v1/create-booking", async (req, res) => {
  const { tenantId, customerName, phone, startsAtISO, endsAtISO } = req.body || {};
  if (!tenantId || !phone || !startsAtISO || !endsAtISO) return res.status(400).json({ error: "Faltan datos" });
  
  const finalName = customerName || "Cliente Web";

  const { data: booking, error } = await supabase.from("bookings").insert([{
      tenant_id: tenantId, resource_id: null, customer_name: finalName, customer_phone: phone,
      starts_at: startsAtISO, ends_at: endsAtISO, status: "confirmed"
  }]).select("*").single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, booking });
});

// ---------------------------------------------------------------------
// 10. API DE REAGENDAMIENTO (TOOL)
// ---------------------------------------------------------------------
app.post("/api/v1/reschedule-booking", async (req, res) => {
  const { tenantId, bookingId, newStartsAtISO, newEndsAtISO } = req.body || {};
  if (!tenantId || !bookingId || !newStartsAtISO || !newEndsAtISO) return res.status(400).json({ error: "missing_fields" });

  const { data: updated, error } = await supabase.from("bookings")
    .update({ starts_at: newStartsAtISO, ends_at: newEndsAtISO, status: "confirmed" })
    .eq("id", bookingId).eq("tenant_id", tenantId).select("*").maybeSingle();

  if (error) return res.status(500).json({ error: "db_error" });
  if (!updated) return res.status(404).json({ error: "not_found" });

  // Notificación (simplificada)
  try {
    const session = await getOrCreateSession(tenantId);
    if (session && session.status === "connected" && updated.customer_phone) {
        const jid = String(updated.customer_phone).replace(/\D/g, "") + "@s.whatsapp.net";
        const templateBody = await getTemplate(tenantId, "booking_rescheduled");
        if (templateBody) {
            const msg = renderTemplate(templateBody, { customer_name: updated.customer_name });
            await session.socket.sendMessage(jid, { text: msg });
        }
    }
  } catch(e) {}

  return res.json({ ok: true, booking: updated });
});

// ---------------------------------------------------------------------
// 11. API DE CANCELACIÓN (TOOL)
// ---------------------------------------------------------------------
app.post("/api/v1/cancel-booking", async (req, res) => {
  const { tenantId, bookingId } = req.body || {};
  if (!tenantId || !bookingId) return res.status(400).json({ error: "missing_fields" });

  const { data: cancelled, error } = await supabase.from("bookings")
    .update({ status: "cancelled" }).eq("id", bookingId).eq("tenant_id", tenantId).select("*").maybeSingle();

  if (error) return res.status(500).json({ error: "db_error" });
  if (!cancelled) return res.status(404).json({ error: "not_found" });

  try {
    const session = await getOrCreateSession(tenantId);
    if (session && session.status === "connected" && cancelled.customer_phone) {
        const jid = String(cancelled.customer_phone).replace(/\D/g, "") + "@s.whatsapp.net";
        const templateBody = await getTemplate(tenantId, "booking_cancelled");
        const msg = templateBody ? renderTemplate(templateBody, { customer_name: cancelled.customer_name }) : "Cita cancelada.";
        await session.socket.sendMessage(jid, { text: msg });
    }
  } catch(e) {}

  return res.json({ ok: true, booking: cancelled });
});

// =====================================================================
// 8. STARTUP
// =====================================================================

async function restoreSessions() {
  try {
    const { data } = await supabase.from("whatsapp_sessions").select("tenant_id").in("status", ["connected", "qrcode"]);
    if (data) for (const row of data) await getOrCreateSession(row.tenant_id);
  } catch (e) { logger.error(e, "Error restore"); }
}

app.listen(PORT, () => {
  logger.info(`🚀 WA server port ${PORT}`);
  restoreSessions();
});
