require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const express = require("express");
const qrcode = require("qrcode-terminal");
const P = require("pino");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

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
// 1. HELPERS: CALENDARIO Y ARCHIVOS (NUEVO)
// ---------------------------------------------------------------------

/**
 * Crea un archivo de calendario (.ics) en memoria para activar alarmas
 */
function createICSFile(title, description, location, startDate, durationMinutes = 60) {
  // Formato de fecha para iCal: YYYYMMDDTHHmmss
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
    'BEGIN:VALARM',           // <--- LA MAGIA DE LA ALARMA
    'TRIGGER:-PT30M',         // <--- Avisar 30 minutos antes
    'ACTION:DISPLAY',
    'DESCRIPTION:Recordatorio de Cita',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  return Buffer.from(icsData);
}

// ---------------------------------------------------------------------
// 2. CEREBRO DEL NEGOCIO
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

// ---------------------------------------------------------------------
// 3. IA CON REGLA DE ORO: NUNCA MENCIONAR HUMANOS
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
    4. Si no sabes la respuesta, di algo natural como: "Déjame confirmar ese detalle exacto un momento..." o "Buena pregunta, déjame revisar...". (Esto da tiempo a que el dueño responda).
    5. Usa emojis moderados. Habla español latino natural.
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
// 4. ACTUALIZAR ESTADO DB
// ---------------------------------------------------------------------

async function updateSessionDB(tenantId, updateData) {
  await supabase.from("whatsapp_sessions").update(updateData).eq("tenant_id", tenantId);
  if (updateData.status) {
      const isConnected = updateData.status === 'connected';
      await supabase.from("tenants").update({ wa_connected: isConnected }).eq("id", tenantId);
  }
}

// ---------------------------------------------------------------------
// 5. CORE WHATSAPP
// ---------------------------------------------------------------------

async function getOrCreateSession(tenantId) {
  const existing = sessions.get(tenantId);
  if (existing && existing.socket) return existing;

  logger.info({ tenantId }, "🔌 Iniciando Socket...");

  const { default: makeWASocket, DisconnectReason } = await import("@whiskeysockets/baileys");
  const { useSupabaseAuthState } = await import("./utils/supabaseAuthState.mjs");

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

    const reply = await generateReply(text, tenantId);
    if (reply) {
      await sock.sendMessage(remoteJid, { text: reply });
    }
  });

  return info;
}

// ---------------------------------------------------------------------
// 6. API ROUTES
// ---------------------------------------------------------------------

app.get("/health", (req, res) => res.json({ ok: true }));

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

// 🔥 ENDPOINT: ENVIAR MENSAJE + ALARMA
app.post("/sessions/:tenantId/send-template", async (req, res) => {
  const { tenantId } = req.params;
  const { event, phone, variables } = req.body;

  const session = sessions.get(tenantId);
  if (!session || session.status !== 'connected') {
      return res.status(400).json({ error: "Desconectado" });
  }

  const template = await getTemplate(tenantId, event);
  if (!template) return res.status(404).json({ error: "Plantilla no encontrada" });

  const text = renderTemplate(template, variables);
  const jid = phone.replace(/\D/g, "") + "@s.whatsapp.net";

  try {
    // 1. Enviar TEXTO
    await session.socket.sendMessage(jid, { text });

    // 2. SI ES CITA CONFIRMADA -> Enviar ALARMA (.ics)
    if (event === 'booking_confirmed' && variables.date && variables.time) {
        
        // Contexto para el archivo
        const context = await getTenantContext(tenantId);
        
        // Intentar parsear fecha (asumiendo formato DD/MM/YYYY y HH:MM AM/PM o ISO)
        // NOTA: Para producción, asegúrate que 'variables.date' y 'time' sean parseables por Date()
        // Aquí hacemos un intento simple combinando strings
        const dateStr = `${variables.date} ${variables.time}`; // Ej: "2025-12-05 10:00"
        const appointmentDate = new Date(dateStr);

        // Si la fecha es válida, generamos el archivo
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
            logger.info({ tenantId }, "📅 Alarma enviada");
        }
    }

    res.json({ ok: true });
  } catch (e) {
    logger.error(e, "Error enviando");
    res.status(500).json({ error: "Error envío" });
  }
});

app.listen(PORT, () => logger.info(`🚀 Ready on ${PORT}`));