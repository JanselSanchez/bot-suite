require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const express = require("express");
const qrcode = require("qrcode-terminal");
const P = require("pino");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

// Importaciones de Date-fns y Lógica de Scheduling (ASUMIMOS ARCHIVO YA CREADO)
const { startOfWeek, addDays, startOfDay } = require('date-fns'); 
const schedulingLogic = require('./utils/wa-server/scheduling-logic.mjs'); // Ruta ajustada a tu estructura


// ---------------------------------------------------------------------
// CONFIGURACIÓN
// ---------------------------------------------------------------------

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 4001;

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

// ---------------------------------------------------------------------
// 1. HELPERS: CALENDARIO Y ARCHIVOS (.ICS)
// ---------------------------------------------------------------------

/**
 * Crea un archivo de calendario (.ics) en memoria para activar alarmas
 */
function createICSFile(title, description, location, startDate, durationMinutes = 60) {
  const formatTime = (date) => date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  
  const start = new Date(startDate);
  const end = new Date(start.getTime() + durationMinutes * 60000);
  const now = new Date();

  const icsData = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PymeBot//Agendador//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${now.getTime()}@pymebot.com`,
    `DTSTAMP:${formatTime(now)}`,
    `DTSTART:${formatTime(start)}`,
    `DTEND:${formatTime(end)}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Recordatorio de Cita',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  return Buffer.from(icsData);
}

// ---------------------------------------------------------------------
// 2. CEREBRO DEL NEGOCIO & CÁLCULO DE DISPONIBILIDAD (NUEVO)
// ---------------------------------------------------------------------

async function getTenantContext(tenantId) {
  try {
    const { data } = await supabase
      .from("tenants")
      .select("name, vertical, description")
      .eq("id", tenantId)
      .maybeSingle();

    if (!data) return { name: "el negocio", vertical: "general", description: "" };
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
async function getAvailableSlots(tenantId, resourceId, startDate, daysToLookAhead = 7) {
    if (!tenantId) return [];

    // 1. Obtener la semana de inicio (Lunes = 1)
    const weekStart = startOfWeek(startDate, { weekStartsOn: 1 });
    const weekEnd = addDays(weekStart, daysToLookAhead);

    // 2. Consulta de Horarios (business_hours)
    const { data: hours } = await supabase
        .from("business_hours")
        .select("dow, is_closed, open_time, close_time")
        .eq("tenant_id", tenantId)
        .order("dow", { ascending: true });

    // 3. Consulta de Citas (bookings)
    let bookingsQuery = supabase
        .from("bookings")
        .select("starts_at, ends_at")
        .eq("tenant_id", tenantId)
        .gte("starts_at", startOfDay(startDate).toISOString())
        .lt("ends_at", addDays(weekEnd, 1).toISOString())
        .in('status', ['confirmed', 'pending']);
    
    // Si se especifica un recurso (barbero), filtramos
    if (resourceId) {
        bookingsQuery = bookingsQuery.eq('resource_id', resourceId);
    }
    const { data: bookings } = await bookingsQuery;

    // 4. Aplicar la lógica de cálculo (Importada de scheduling-logic.mjs)
    const openWindows = schedulingLogic.weeklyOpenWindows(weekStart, hours || []);
    
    // Generar los slots disponibles
    const offerableSlots = schedulingLogic.generateOfferableSlots(
        openWindows, 
        bookings || [], 
        30 // Slots de 30 minutos
    );

    // Filtrar slots pasados y devolver
    return offerableSlots.filter(slot => slot.start >= startDate);
}


// ---------------------------------------------------------------------
// 4. IA CON REGLA DE ORO
// ---------------------------------------------------------------------

async function generateReply(text, tenantId) {
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
  
  const systemPrompt = `
    Eres el asistente virtual de "${context.name}".
    Tipo: ${context.vertical}.
    Descripción: ${context.description}.

    REGLAS DE ORO:
    1. Responde dudas sobre nuestros servicios de forma breve y amable.
    2. TU OBJETIVO es conseguir que agenden una cita.
    3. PROHIBIDO decir frases como "te paso con un humano", "un asesor te atenderá" o "no tengo esa información".
    4. Si no sabes la respuesta, usa una táctica de espera natural como: 
       - "Déjame confirmar ese detalle exacto un momento..." 
       - "Buena pregunta, déjame revisar la disponibilidad exacta..."
       (Esto da tiempo a que el dueño real conteste si es necesario).
    5. Actúa como parte del equipo, no como un robot externo.
  `.trim();

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: cleanText },
      ],
      max_tokens: 250,
    });
    return completion.choices?.[0]?.message?.content?.trim();
  } catch (err) {
    logger.error("Error OpenAI:", err);
    return null;
  }
}

// ---------------------------------------------------------------------
// 5. ACTUALIZAR ESTADO DB
// ---------------------------------------------------------------------

async function updateSessionDB(tenantId, updateData) {
  await supabase.from("whatsapp_sessions").update(updateData).eq("tenant_id", tenantId);
  if (updateData.status) {
      const isConnected = updateData.status === 'connected';
      await supabase.from("tenants").update({ wa_connected: true }).eq("id", tenantId);
  }
}

// ---------------------------------------------------------------------
// 6. CORE WHATSAPP
// ---------------------------------------------------------------------

async function getOrCreateSession(tenantId) {
  const existing = sessions.get(tenantId);
  if (existing && existing.socket) return existing;

  logger.info({ tenantId }, "🔌 Iniciando Socket...");

  const { default: makeWASocket, DisconnectReason } = await import("@whiskeysockets/baileys");
  // Asegúrate que la ruta sea correcta a tu archivo .mjs
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
      info.qr = qr;
      logger.info({ tenantId }, "✨ QR Generado");
      await updateSessionDB(tenantId, { qr_data: qr, status: "qrcode", last_seen_at: new Date().toISOString() });
    }

    if (connection === "open") {
      info.status = "connected";
      info.qr = null;
      logger.info({ tenantId }, "✅ Conectado");
      let phone = sock?.user?.id ? sock.user.id.split(":")[0] : null;
      await updateSessionDB(tenantId, { status: "connected", qr_data: null, phone_number: phone, last_connected_at: new Date().toISOString(), last_seen_at: new Date().toISOString() });
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

    // Generar respuesta
    const reply = await generateReply(text, tenantId);
    if (reply) {
      await sock.sendMessage(remoteJid, { text: reply });
    }
  });

  return info;
}

// ---------------------------------------------------------------------
// 7. API ROUTES
// ---------------------------------------------------------------------

app.get("/health", (req, res) => res.json({ ok: true, active_sessions: sessions.size }));

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
  await updateSessionDB(req.params.tenantId, { status: "disconnected", qr_data: null, auth_state: null });
  res.json({ ok: true });
});

/**
 * 🔥 ENDPOINT MAESTRO: Envía la plantilla Y la alarma
 */
app.post("/sessions/:tenantId/send-template", async (req, res) => {
  const { tenantId } = req.params;
  const { event, phone, variables } = req.body; 

  if (!event || !phone) return res.status(400).json({ error: "Faltan datos" });

  let session = sessions.get(tenantId);
  if (!session || session.status !== 'connected') {
      try { session = await getOrCreateSession(tenantId); } catch(e){}
  }

  if (!session || session.status !== 'connected') {
      return res.status(400).json({ error: "Bot no conectado." });
  }

  // 1. Obtener la plantilla de texto
  const templateBody = await getTemplate(tenantId, event);
  if (!templateBody) {
      return res.status(404).json({ error: `Plantilla no encontrada: ${event}` });
  }

  const message = renderTemplate(templateBody, variables);
  const jid = phone.replace(/\D/g, "") + "@s.whatsapp.net";

  try {
    // 2. Enviar el MENSAJE DE TEXTO primero
    await session.socket.sendMessage(jid, { text: message });
    
    // 3. LOGICA DE ALARMA: Si es una confirmación de cita, enviamos el .ICS
    if (event === 'booking_confirmed' && variables.date && variables.time) {
        
        const context = await getTenantContext(tenantId);
        
        // Construimos fecha (Tu frontend debe mandar date: "YYYY-MM-DD", time: "HH:MM")
        const dateStr = `${variables.date} ${variables.time}`;
        const appointmentDate = new Date(dateStr);

        if (!isNaN(appointmentDate.getTime())) {
            const icsBuffer = createICSFile(
                `Cita en ${context.name}`, 
                `Servicio con ${variables.resource_name || 'Nosotros'}.`,
                "En el local",
                appointmentDate
            );

            await session.socket.sendMessage(jid, { 
                document: icsBuffer, 
                mimetype: 'text/calendar', 
                fileName: 'agendar_cita.ics',
                caption: '📅 Toca este archivo para agregar el recordatorio a tu calendario.'
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
// 8. API DE CONSULTA DE DISPONIBILIDAD (NUEVO)
// ---------------------------------------------------------------------

/**
 * Endpoint para que la IA consulte la disponibilidad.
 * @URL /api/v1/availability?tenantId=...&resourceId=...&date=...
 */
app.get("/api/v1/availability", async (req, res) => {
    const { tenantId, resourceId, date } = req.query;
    
    if (!tenantId || !date) {
        return res.status(400).json({ error: "Faltan tenantId y date" });
    }

    const requestedDate = new Date(date);
    if (isNaN(requestedDate.getTime())) {
        return res.status(400).json({ error: "Formato de fecha inválido" });
    }
    
    // Asumimos que el recurso (barbero) siempre tiene un ID para este punto
    const slots = await getAvailableSlots(
        tenantId, 
        resourceId, 
        requestedDate, 
        7 // Buscar 7 días hacia adelante
    );

    // Formatear slots para que la IA los pueda leer fácilmente
    const formattedSlots = slots.map(s => 
        `${s.start.toLocaleString('es-DO', { weekday: 'short', month: 'numeric', day: 'numeric' })} a las ${s.start.toTimeString().slice(0, 5)}`
    );

    res.json({ 
        ok: true, 
        available_slots_count: slots.length,
        available_slots: formattedSlots.slice(0, 10) // Devolvemos solo los primeros 10 para no sobrecargar
    });
});


app.listen(PORT, () => logger.info(`🚀 Ready on ${PORT}`));