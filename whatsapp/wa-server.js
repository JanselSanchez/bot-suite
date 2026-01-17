/**
 * wa-server.js — VERSIÓN FINAL CORREGIDA (N8N + NUCLEAR FIX + AUTO-ICS + TEXT IDs)
 *
 * ✅ IDs: TODO TEXT (tenantId, customerId, etc.).
 * ✅ CEREBRO: n8n (Prioridad) + OpenAI (Fallback).
 * ✅ CONEXIÓN: Nuclear (Borrado físico de sesión + wait QR/connected).
 * ✅ COMPATIBILIDAD: Browser "Creativa Web" en Windows (Universal).
 * ✅ AUTO-ICS: Envío automático de archivo de calendario al crear/reagendar.
 * ✅ FUSIÓN: Integrado con Next.js (Dashboard) + Modo Producción forzado.
 */

require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// 🔥 FIX MEMORIA: Forzamos producción explícitamente para evitar caídas
process.env.NODE_ENV = "production";

const express = require("express");
const qrcode = require("qrcode-terminal");
const P = require("pino");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const next = require("next"); // 👈 FUSIÓN: Importamos Next.js

// Date-fns
const { startOfWeek, addDays, startOfDay } = require("date-fns");

// estado de conversación en Supabase
const convoState = require("./conversationState");

// ---------------------------------------------------------------------
// CONFIGURACIÓN GLOBAL & NEXT.JS (FIX DIRECTORIO)
// ---------------------------------------------------------------------

// 🔥 FIX CRÍTICO: Le decimos a Next.js que la web está UNA CARPETA ATRÁS (..)
const projectRoot = path.join(__dirname, "..");

// 'dev: false' obliga a usar la versión compilada (Rápida y Ligera)
const dev = false; 
const nextApp = next({ dev, dir: projectRoot });
const handle = nextApp.getRequestHandler();

const app = express();

// 🔥 FIX DATOS: NO usamos express.json() global para no romper Next.js
// Creamos un parser específico para usarlo solo en las rutas del bot.
const jsonParser = express.json({ limit: "20mb" });

// ---------------------------------------------------------------------
// MIDDLEWARES DE RUTAS (CORREGIDO PARA LOGIN)
// ---------------------------------------------------------------------

// Aplicamos el parser SOLO a las rutas del Bot
app.use("/sessions", jsonParser);

// ✅ FIX AUTH: Excluimos explícitamente las rutas de Auth de Next.js del parser de Express
// para evitar que las peticiones se queden en (pending).
app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/auth")) {
    return next(); 
  }
  jsonParser(req, res, next);
});

app.use("/health", jsonParser);

const PORT = process.env.PORT || process.env.WA_SERVER_PORT || 4001;

// Timezone configurable (fallback RD)
const TIMEZONE_LOCALE = process.env.TIMEZONE_LOCALE || "America/Santo_Domingo";

// ✅ Offset fijo (RD es -04:00 normalmente). Úsalo para parsing ICS robusto.
const TZ_OFFSET = process.env.TZ_OFFSET || "-04:00";

// Si sigues usando el viejo offset horario para business_hours
const SERVER_OFFSET_HOURS = Number(process.env.SERVER_OFFSET_HOURS || 4);

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
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// OpenAI con fallback
const openaiApiKey =
  process.env.OPENAI_API_KEY ||
  process.env.OPENAI_KEY ||
  process.env.OPENAI_SECRET ||
  null;

if (!openaiApiKey) {
  console.warn(
    "[wa-server] ⚠️ No hay API key de OpenAI configurada (OPENAI_API_KEY / OPENAI_KEY). El fallback de IA no va a funcionar."
  );
}
const openai = openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null;

/**
 * sessions: Map<tenantId, {
 * tenantId,
 * socket,
 * status,
 * qr,
 * conversations: Map<phone, { history: Array<{role, content}> }>
 * }>
 */
const sessions = new Map();

// Carpeta persistencia
const WA_SESSIONS_ROOT =
  process.env.WA_SESSIONS_DIR || path.join(__dirname, ".wa-sessions");

try {
  if (!fs.existsSync(WA_SESSIONS_ROOT)) fs.mkdirSync(WA_SESSIONS_ROOT, { recursive: true });
} catch (e) {
  console.error("[wa-server] No pude crear WA_SESSIONS_ROOT:", WA_SESSIONS_ROOT, e);
}

// ---------------------------------------------------------------------
// HELPERS (Sleep & Wait)
// ---------------------------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ✅ Espera hasta que esté connected o al menos tenga QR listo
async function waitForReady(tenantId, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = sessions.get(String(tenantId));
    if (s?.status === "connected" && s?.socket) return s;
    if (s?.status === "qrcode" && s?.qr) return s;
    await sleep(400);
  }
  return sessions.get(String(tenantId)) || null;
}

// =====================================================================
// 1. LÓGICA DE SCHEDULING
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
 * Calcula ventanas abiertas basadas en business_hours.
 */
function weeklyOpenWindows(weekStart, businessHours) {
  const windows = [];
  let currentDayCursor = new Date(weekStart);

  for (let i = 0; i < 7; i++) {
    const currentDow = currentDayCursor.getDay(); // 0=Dom, 1=Lun...

    const dayConfig = businessHours.find(
      (bh) => bh.dow === currentDow && bh.is_closed === false
    );

    if (dayConfig && dayConfig.open_time && dayConfig.close_time) {
      const { h: openH, m: openM } = hmsToParts(toHHMM(dayConfig.open_time));
      const { h: closeH, m: closeM } = hmsToParts(toHHMM(dayConfig.close_time));

      const start = new Date(currentDayCursor);
      start.setHours(openH + SERVER_OFFSET_HOURS, openM, 0, 0);

      const end = new Date(currentDayCursor);
      end.setHours(closeH + SERVER_OFFSET_HOURS, closeM, 0, 0);

      if (end > start) windows.push({ start, end });
    }

    currentDayCursor.setDate(currentDayCursor.getDate() + 1);
  }
  return windows;
}

/**
 * Resta bookings a las ventanas abiertas.
 */
function generateOfferableSlots(openWindows, bookings, stepMin = 30) {
  const slots = [];
  for (const window of openWindows) {
    let cursor = new Date(window.start);
    const windowEnd = new Date(window.end);

    while (cursor.getTime() < windowEnd.getTime()) {
      const slotEnd = new Date(cursor);
      slotEnd.setMinutes(slotEnd.getMinutes() + stepMin);

      if (slotEnd.getTime() > windowEnd.getTime()) break;

      const isBusy = (bookings || []).some((booking) => {
        const busyStart = new Date(booking.starts_at);
        const busyEnd = new Date(booking.ends_at);
        return (
          cursor.getTime() < busyEnd.getTime() &&
          slotEnd.getTime() > busyStart.getTime()
        );
      });

      if (!isBusy) slots.push({ start: new Date(cursor), end: slotEnd });

      cursor.setMinutes(cursor.getMinutes() + stepMin);
    }
  }
  return slots;
}

// ---------------------------------------------------------------------
// 2. HELPERS: ICS
// ---------------------------------------------------------------------

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
    `SUMMARY:${String(title || "").replace(/\r?\n/g, " ")}`,
    `DESCRIPTION:${String(description || "").replace(/\r?\n/g, " ")}`,
    `LOCATION:${String(location || "").replace(/\r?\n/g, " ")}`,
    "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Recordatorio de Cita",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  return Buffer.from(icsData, "utf8");
}

function looksLikeICS(str) {
  if (!str || typeof str !== "string") return false;
  return str.includes("BEGIN:VCALENDAR") && str.includes("END:VCALENDAR");
}

function looksLikeBase64(str) {
  if (!str || typeof str !== "string") return false;
  const s = str.trim();
  if (s.length < 40) return false;
  if (s.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/=]+$/.test(s);
}

function icsToBuffer(icsData) {
  if (!icsData) return null;

  if (typeof icsData !== "string") {
    try {
      icsData = String(icsData);
    } catch {
      return null;
    }
  }

  const raw = icsData.trim();

  if (looksLikeICS(raw)) {
    const normalized = raw.replace(/\r?\n/g, "\r\n");
    return Buffer.from(normalized, "utf8");
  }

  if (looksLikeBase64(raw)) {
    const buf = Buffer.from(raw, "base64");
    const preview = buf.toString("utf8", 0, Math.min(buf.length, 300));
    if (!looksLikeICS(preview)) return null;
    return buf;
  }

  return null;
}

async function sendICS(sock, remoteJid, icsData, opts = {}) {
  const buf = icsToBuffer(icsData);
  if (!buf) return false;

  await sock.sendMessage(remoteJid, {
    document: buf,
    mimetype: "text/calendar; charset=utf-8",
    fileName: opts.fileName || "cita_confirmada.ics",
    caption: opts.caption || "📅 Toca aquí para guardar en tu calendario",
  });

  return true;
}

// ✅ Parsing robusto de date+time usando offset fijo
function parseLocalDateTimeToDate(dateStr, timeStr) {
  // soporta: dateStr "YYYY-MM-DD" y timeStr "HH:mm" o "HH:mmAM/PM" o "3:00 PM"
  const d = String(dateStr || "").trim();
  const t = String(timeStr || "").trim().toUpperCase();

  if (!d) return null;

  // Si viene ISO completo ya, úsalo
  if (d.includes("T")) {
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? null : dt;
  }

  // time limpio
  let hh = 9;
  let mm = 0;
  if (t) {
    const match = t.match(/(\d{1,2})\s*:\s*(\d{2})\s*(AM|PM)?/i) || t.match(/(\d{1,2})\s*(AM|PM)/i);
    if (match) {
      hh = Number(match[1]);
      mm = match[2] ? Number(match[2]) : 0;
      const ampm = match[3] || match[2]; // según regex
      const ap = ampm ? String(ampm).toUpperCase() : null;
      if (ap === "PM" && hh < 12) hh += 12;
      if (ap === "AM" && hh === 12) hh = 0;
    } else {
      const hm = t.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
      if (hm) {
        hh = Number(hm[1]);
        mm = Number(hm[2]);
      }
    }
  }

  const hh2 = pad2(hh);
  const mm2 = pad2(mm);

  // RD offset fijo
  const iso = `${d}T${hh2}:${mm2}:00${TZ_OFFSET}`;
  const dt = new Date(iso);
  return isNaN(dt.getTime()) ? null : dt;
}

// ---------------------------------------------------------------------
// 3. DATA HELPERS
// ---------------------------------------------------------------------

async function getTenantContext(tenantId) {
  const tid = String(tenantId || "");
  try {
    const { data } = await supabase
      .from("tenants")
      .select("name, vertical, description")
      .eq("id", tid)
      .maybeSingle();

    if (!data) return { name: "el negocio", vertical: "general", description: "" };
    return data;
  } catch (e) {
    return { name: "el negocio", vertical: "general", description: "" };
  }
}

async function getTemplate(tenantId, eventKey) {
  const tid = String(tenantId || "");
  const { data } = await supabase
    .from("message_templates")
    .select("body")
    .eq("tenant_id", tid)
    .eq("event", eventKey)
    .eq("active", true)
    .maybeSingle();

  return data?.body || null;
}

function renderTemplate(body, variables = {}) {
  if (!body) return "";
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] || "");
}

async function getAvailableSlots(tenantId, resourceId, startDate, daysToLookAhead = 7) {
  const tid = String(tenantId || "");
  if (!tid) return [];

  const weekStart = startOfWeek(startDate, { weekStartsOn: 1 });
  const weekEnd = addDays(weekStart, daysToLookAhead);

  const { data: hours } = await supabase
    .from("business_hours")
    .select("dow, is_closed, open_time, close_time")
    .eq("tenant_id", tid)
    .eq("is_closed", false)
    .order("dow", { ascending: true });

  let bookingsQuery = supabase
    .from("bookings")
    .select("starts_at, ends_at, resource_id, status")
    .eq("tenant_id", tid)
    .gte("starts_at", startOfDay(startDate).toISOString())
    .lt("ends_at", addDays(weekEnd, 1).toISOString())
    .in("status", ["confirmed", "pending"]);

  if (resourceId) bookingsQuery = bookingsQuery.eq("resource_id", String(resourceId));

  const { data: bookings } = await bookingsQuery;

  const openWindows = weeklyOpenWindows(weekStart, hours || []);
  const offerableSlots = generateOfferableSlots(openWindows, bookings || [], 30);

  return offerableSlots.filter((slot) => slot.start >= startDate);
}

// ---------------------------------------------------------------------
// 4. INTENT_KEYWORDS
// ---------------------------------------------------------------------

function normalizeForIntent(str = "") {
  return str
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

async function buildIntentHints(tenantId, userText) {
  try {
    const tid = String(tenantId || "");
    const normalizedUser = normalizeForIntent(userText);

    const { data, error } = await supabase
      .from("intent_keywords")
      .select("intent, frase, peso, es_error, locale, term, tenant_id")
      .or(`tenant_id.eq.${tid},tenant_id.is.null`);

    if (error || !data || data.length === 0) return "";

    const scores = {}; // intent -> { score, terms: Set<string> }

    for (const row of data) {
      if (
        row.locale &&
        normalizeForIntent(row.locale) !== normalizeForIntent("es-DO") &&
        normalizeForIntent(row.locale) !== normalizeForIntent("es")
      ) continue;

      if (row.es_error) continue;

      const term = row.term || row.frase;
      if (!term) continue;

      const normTerm = normalizeForIntent(term);
      if (!normTerm) continue;

      if (normalizedUser.includes(normTerm)) {
        const intent = row.intent || "desconocido";
        if (!scores[intent]) {
          scores[intent] = { intent, score: 0, terms: new Set() };
        }
        const peso = typeof row.peso === "number" ? row.peso : 1;
        scores[intent].score += peso;
        scores[intent].terms.add(term);
      }
    }

    const intentsArr = Object.values(scores);
    if (intentsArr.length === 0) return "";

    intentsArr.sort((a, b) => b.score - a.score);
    const topIntents = intentsArr.slice(0, 3).map((i) => ({
      intent: i.intent,
      score: i.score,
      terms: Array.from(i.terms),
    }));

    return JSON.stringify({ engine: "intent_keywords", intents: topIntents });
  } catch (e) {
    console.error("[buildIntentHints] error:", e);
    return "";
  }
}

// ---------------------------------------------------------------------
// 5. TOOLS (IA)
// ---------------------------------------------------------------------

const tools = [
  {
    type: "function",
    function: {
      name: "check_availability",
      description:
        "Consulta disponibilidad. Úsalo para ver huecos libres para citas o reservas.",
      parameters: {
        type: "object",
        properties: { requestedDate: { type: "string", description: "Fecha ISO base." } },
        required: ["requestedDate"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_booking",
      description:
        "Crea una Cita, Reserva de Mesa o Pedido Programado. NO pidas serviceId si el cliente no lo especifica.",
      parameters: {
        type: "object",
        properties: {
          customerName: { type: "string" },
          phone: { type: "string" },
          startsAtISO: { type: "string" },
          endsAtISO: { type: "string" },
          notes: { type: "string" },
          serviceId: { type: "string" },
        },
        required: ["phone", "startsAtISO"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_catalog",
      description:
        "Consulta el menú, servicios o productos del negocio para dar precios y detalles.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "human_handoff",
      description:
        "Úsalo cuando el cliente pida hablar con una persona real o si no sabes la respuesta.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "reschedule_booking",
      description:
        "Reagenda una cita activa del cliente usando su teléfono y nueva fecha/hora.",
      parameters: {
        type: "object",
        properties: {
          customerPhone: { type: "string" },
          newStartsAtISO: { type: "string" },
          newEndsAtISO: { type: "string" },
        },
        required: ["customerPhone", "newStartsAtISO"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_booking",
      description:
        "Cancela la última cita activa de un cliente usando su teléfono.",
      parameters: {
        type: "object",
        properties: { customerPhone: { type: "string" } },
        required: ["customerPhone"],
      },
    },
  },
];

// ---------------------------------------------------------------------
// 6. OPENAI FALLBACK
// ---------------------------------------------------------------------

async function generateReply(text, tenantId, pushName, historyMessages = [], userPhone = null) {
  if (!openai) {
    logger.error("[generateReply] OpenAI no está configurado, no puedo generar respuesta IA.");
    return null;
  }

  const tid = String(tenantId || "");

  const { data: profile } = await supabase
    .from("business_profiles")
    .select("*")
    .eq("tenant_id", tid)
    .maybeSingle();

  const businessType = profile?.business_type || "general";
  const botName = profile?.bot_name || "Asistente Virtual";
  const botTone = profile?.bot_tone || "Amable y profesional";
  const customRules = profile?.custom_instructions || "Ayuda al cliente a agendar o comprar.";
  const humanPhone = profile?.human_handoff_phone || null;

  const now = new Date();
  const currentDateStr = now.toLocaleString("es-DO", {
    timeZone: TIMEZONE_LOCALE,
    dateStyle: "full",
    timeStyle: "short",
  });

  const intentHints = await buildIntentHints(tid, text);

  let typeContext = "";
  switch (businessType) {
    case "restaurante":
      typeContext =
        "Eres el host de un restaurante. Tu objetivo es RESERVAR MESAS o TOMAR PEDIDOS. Cuando agendes, en 'notes' guarda la cantidad de personas.";
      break;
    case "clinica":
      typeContext =
        "Eres recepcionista médico. Tu objetivo es agendar CITAS. Sé formal y discreto. Pregunta brevemente el motivo y guárdalo en 'notes'.";
      break;
    case "barberia":
      typeContext =
        "Eres el asistente de una barbería. Agenda citas. Si no especifican barbero, agenda con cualquiera.";
      break;
    default:
      typeContext =
        "Eres un asistente general de negocios. Tu objetivo es AGENDAR citas o responder dudas.";
  }

  const systemPrompt = `
IDENTIDAD: Te llamas "${botName}".
TONO: ${botTone}.
ROL: ${typeContext}

INFORMACIÓN DEL NEGOCIO (Reglas de Oro):
"${customRules}"

DATOS ACTUALES:
- Fecha y Hora Local: ${currentDateStr}.
- Cliente: "${pushName}".
- Teléfono WhatsApp del cliente: ${userPhone || "desconocido"}.
- INTENTOS DETECTADOS (intent_keywords): ${intentHints || "ninguno claro"}.

INSTRUCCIONES:
1) Si el cliente propone una hora y hay hueco, agenda de inmediato.
2) Si preguntan precios/menú, usa get_catalog (no inventes).
3) Si falta serviceId, agenda con serviceId:null y mete detalle en notes.
4) Si piden humano/soporte, usa human_handoff.
5) Si check_availability devuelve slots, lista por label y pide número.
6) Si el cliente elige opción N, usa slot.isoStart para create_booking.
7) Si tú propusiste una hora y el cliente dice "sí", agenda ya.
`.trim();

  const messages = [
    { role: "system", content: systemPrompt },
    ...(Array.isArray(historyMessages) ? historyMessages : []),
    { role: "user", content: text },
  ];

  try {
    let completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      tools,
      tool_choice: "auto",
    });

    let message = completion.choices[0].message;

    if (message.tool_calls) {
      messages.push(message);

      for (const toolCall of message.tool_calls) {
        const fnName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments || "{}");
        let response;

        if (fnName === "check_availability") {
          const rawSlots = await getAvailableSlots(
            tid,
            null,
            new Date(args.requestedDate),
            7
          );

          const sortedSlots = (rawSlots || []).sort(
            (a, b) => a.start.getTime() - b.start.getTime()
          );

          if (sortedSlots.length > 0) {
            const slotObjects = sortedSlots.slice(0, 12).map((s, i) => {
              const timeStr = s.start.toLocaleString("es-DO", {
                timeZone: TIMEZONE_LOCALE,
                hour: "2-digit",
                minute: "2-digit",
                hour12: true,
              });
              return {
                index: i + 1,
                label: `${i + 1}) ${timeStr}`,
                isoStart: s.start.toISOString(),
                isoEnd: s.end.toISOString(),
              };
            });

            const listText = slotObjects.map((s) => s.label).join("\n");

            response = JSON.stringify({
              message:
                "Aquí tienes los horarios disponibles. Elige un número.",
              slots: slotObjects,
              plain_list: listText,
            });
          } else {
            response = JSON.stringify({
              message:
                "No hay horarios disponibles para esa fecha. Intenta otro día.",
              slots: [],
            });
          }
        } else if (fnName === "get_catalog") {
          const { data: items } = await supabase
            .from("items")
            .select("name, price_cents, description, type")
            .eq("tenant_id", tid)
            .eq("is_active", true);

          if (items && items.length > 0) {
            const list = items
              .map((i) => {
                const price = (i.price_cents / 100).toFixed(0);
                return `- ${i.name} ($${price}): ${i.description || ""}`;
              })
              .join("\n");
            response = JSON.stringify({ catalog: list });
          } else {
            response = JSON.stringify({
              message:
                "El catálogo está vacío en el sistema.",
            });
          }
        } else if (fnName === "create_booking") {
          const phoneArg = String(args.phone || userPhone || "").trim();
          const startsISO = String(args.startsAtISO || "").trim();

          if (!phoneArg || !startsISO) {
            response = JSON.stringify({
              success: false,
              error: "missing_phone_or_start",
            });
          } else {
            const start = new Date(startsISO);
            const endISO =
              args.endsAtISO ||
              new Date(start.getTime() + 60 * 60000).toISOString();

            const { data: booking, error } = await supabase
              .from("bookings")
              .insert([
                {
                  tenant_id: tid,
                  resource_id: null,
                  service_id: args.serviceId || null,
                  customer_name: args.customerName || pushName,
                  customer_phone: phoneArg,
                  starts_at: startsISO,
                  ends_at: endISO,
                  status: "confirmed",
                  notes: args.notes || "Agendado por Bot",
                },
              ])
              .select("id")
              .single();

            if (!error && booking?.id) {
              // ✅ AUTO ICS desde servidor (fallback)
              try {
                const session = sessions.get(tid);
                if (session?.status === "connected" && session.socket) {
                  const context = await getTenantContext(tid);

                  const dateStr = start.toLocaleString("es-DO", {
                    timeZone: TIMEZONE_LOCALE,
                    dateStyle: "full",
                    timeStyle: "short",
                  });

                  const icsBuffer = createICSFile(
                    `Cita en ${context.name}`,
                    `Cita confirmada para ${dateStr}`,
                    "En el local",
                    start
                  );

                  const targetJid = phoneArg.replace(/\D/g, "") + "@s.whatsapp.net";

                  await session.socket.sendMessage(targetJid, {
                    document: icsBuffer,
                    mimetype: "text/calendar; charset=utf-8",
                    fileName: "cita.ics",
                    caption: "📅 Tu cita ha sido agendada. Guarda este archivo.",
                  });
                }
              } catch (errICS) {
                logger.error({ err: errICS }, "Error enviando ICS automático (no crítico)");
              }

              response = JSON.stringify({
                success: true,
                bookingId: booking.id,
                message: "Reserva creada.",
              });
            } else {
              response = JSON.stringify({
                success: false,
                error: "db_error",
                detail: error?.message || "desconocido",
              });
            }
          }
        } else if (fnName === "human_handoff") {
          if (humanPhone) {
            const clean = String(humanPhone).replace(/\D/g, "");
            response = JSON.stringify({
              message: `Puedes escribir al encargado aquí: https://wa.me/${clean}`,
            });
          } else {
            response = JSON.stringify({
              message:
                "No tengo un número directo configurado. Déjanos tu mensaje y te contactamos.",
            });
          }
        } else if (fnName === "reschedule_booking") {
          const phoneFilter = String(args.customerPhone || args.phone || userPhone || "").trim();

          if (!phoneFilter) {
            response = JSON.stringify({ success: false, error: "missing_phone" });
          } else {
            const { data: booking } = await supabase
              .from("bookings")
              .select("id")
              .eq("tenant_id", tid)
              .eq("customer_phone", phoneFilter)
              .in("status", ["confirmed", "pending"])
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (booking?.id) {
              const newStart = args.newStartsAtISO;
              const newEnd =
                args.newEndsAtISO ||
                new Date(new Date(newStart).getTime() + 60 * 60000).toISOString();

              const { error } = await supabase
                .from("bookings")
                .update({ starts_at: newStart, ends_at: newEnd })
                .eq("id", booking.id);

              response = !error
                ? JSON.stringify({ success: true, message: "Cita reagendada." })
                : JSON.stringify({ success: false, error: "db_update_failed" });
            } else {
              response = JSON.stringify({ success: false, error: "no_active_booking_found" });
            }
          }
        } else if (fnName === "cancel_booking") {
          const phoneFilter = String(args.customerPhone || args.phone || userPhone || "").trim();

          if (!phoneFilter) {
            response = JSON.stringify({ success: false, error: "missing_phone" });
          } else {
            const { data: booking } = await supabase
              .from("bookings")
              .select("id")
              .eq("tenant_id", tid)
              .eq("customer_phone", phoneFilter)
              .in("status", ["confirmed", "pending"])
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (booking?.id) {
              const { error } = await supabase
                .from("bookings")
                .update({ status: "cancelled" })
                .eq("id", booking.id);

              response = !error
                ? JSON.stringify({ success: true, message: "Cita cancelada." })
                : JSON.stringify({ success: false, error: "db_update_failed" });
            } else {
              response = JSON.stringify({ success: false, error: "no_active_booking_found" });
            }
          }
        } else {
          response = JSON.stringify({ ok: true });
        }

        messages.push({
          tool_call_id: toolCall.id,
          role: "tool",
          name: fnName,
          content: response,
        });
      }

      const finalReply = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
      });
      return finalReply.choices[0].message.content.trim();
    }

    return message.content?.trim() || "";
  } catch (err) {
    logger.error("Error OpenAI:", err);
    return null;
  }
}

// ---------------------------------------------------------------------
// 7. SESSION DB SYNC
// ---------------------------------------------------------------------

async function updateSessionDB(tenantId, updateData) {
  const tid = String(tenantId || "");
  if (!tid) return;

  try {
    const { data: existing, error: selectError } = await supabase
      .from("whatsapp_sessions")
      .select("id")
      .eq("tenant_id", tid)
      .maybeSingle();

    if (selectError) {
      console.error("[updateSessionDB] Error select whatsapp_sessions:", selectError);
      return;
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from("whatsapp_sessions")
        .update(updateData)
        .eq("tenant_id", tid);

      if (updateError) {
        console.error("[updateSessionDB] Error update whatsapp_sessions:", updateError);
      }
    } else {
      const row = { tenant_id: tid, ...updateData };
      const { error: insertError } = await supabase
        .from("whatsapp_sessions")
        .insert([row]);

      if (insertError) {
        console.error("[updateSessionDB] Error insert whatsapp_sessions:", insertError);
      }
    }

    if (updateData.status) {
      const isConnected = updateData.status === "connected";
      const { error: tenantError } = await supabase
        .from("tenants")
        .update({ wa_connected: isConnected })
        .eq("id", tid);

      if (tenantError) {
        console.error("[updateSessionDB] Error update tenants.wa_connected:", tenantError);
      }
    }
  } catch (e) {
    console.error("[updateSessionDB] Error inesperado:", e);
  }
}

// ---------------------------------------------------------------------
// 8. customers + booking events
// ---------------------------------------------------------------------

async function getOrCreateCustomer(tenantId, phoneNumber) {
  const tid = String(tenantId || "");
  const phone = String(phoneNumber || "");

  if (!tid || !phone) {
    throw new Error("[wa-server] tenantId y phoneNumber requeridos para customer.");
  }

  const { data, error } = await supabase
    .from("customers")
    .select("id")
    .eq("tenant_id", tid)
    .eq("phone_number", phone)
    .maybeSingle();

  if (error) {
    logger.error("[wa-server] Error al buscar customer:", error);
    throw error;
  }

  if (data?.id) return data.id;

  const { data: created, error: insertError } = await supabase
    .from("customers")
    .insert({ tenant_id: tid, phone_number: phone })
    .select("id")
    .single();

  if (insertError) {
    logger.error("[wa-server] Error al crear customer:", insertError);
    throw insertError;
  }

  return created.id;
}

function buildBookingEventFromMessage(text, session) {
  const lower = (text || "").toLowerCase().trim();
  const currentFlow = session.current_flow;
  const step = session.step;

  if (lower === "cancelar" || lower === "olvídalo" || lower === "olvidalo") {
    return { type: "CANCEL_FLOW" };
  }

  if (!currentFlow) {
    return { type: "START_BOOKING" };
  }

  if (currentFlow === "BOOKING") {
    if (step === "SELECT_SERVICE") {
      let serviceId = null;

      if (lower.includes("corte") && lower.includes("barba")) {
        serviceId = "service_corte_barba";
      } else if (lower.includes("corte")) {
        serviceId = "service_corte";
      } else if (lower.includes("barba")) {
        serviceId = "service_barba";
      }

      return { type: "SERVICE_PROVIDED", serviceId };
    }

    if (step === "SELECT_DATE") {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      const dd = String(today.getDate()).padStart(2, "0");
      let targetDate = `${yyyy}-${mm}-${dd}`;

      const isTomorrow = lower.includes("mañana") || lower.includes("manana");
      if (isTomorrow) {
        const t2 = new Date(today.getTime() + 24 * 60 * 60 * 1000);
        const yyyy2 = t2.getFullYear();
        const mm2 = String(t2.getMonth() + 1).padStart(2, "0");
        const dd2 = String(t2.getDate()).padStart(2, "0");
        targetDate = `${yyyy2}-${mm2}-${dd2}`;
      }

      return { type: "DATE_PROVIDED", date: targetDate };
    }

    if (step === "SELECT_HOUR") {
      const num = parseInt(lower, 10);
      if (!isNaN(num)) return { type: "HOUR_PROVIDED", slotIndex: num };
      return { type: "HOUR_PROVIDED" };
    }
  }

  return { type: "START_BOOKING" };
}

// ---------------------------------------------------------------------
// 9. AUTH STATE
// ---------------------------------------------------------------------

async function useSupabaseAuthState(tenantId) {
  const tid = String(tenantId || "");
  if (!tid) throw new Error("useSupabaseAuthState requiere tenantId");

  const { useMultiFileAuthState } = await import("@whiskeysockets/baileys");
  const sessionFolder = path.join(WA_SESSIONS_ROOT, tid);

  if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
  return { state, saveCreds };
}

// ---------------------------------------------------------------------
// 10. CORE WHATSAPP
// ---------------------------------------------------------------------

async function getOrCreateSession(tenantId) {
  const tid = String(tenantId || "");
  const existing = sessions.get(tid);
  if (existing && existing.socket) return existing;

  logger.info({ tenantId: tid }, "🔌 Iniciando Socket...");

  const { default: makeWASocket, DisconnectReason } = await import("@whiskeysockets/baileys");
  const { state, saveCreds } = await useSupabaseAuthState(tid);

  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ["Creativa Web", "Chrome", "10.0.0"],
    syncFullHistory: false,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 10000,
    retryRequestDelayMs: 5000,
  });

  const info = {
    tenantId: tid,
    socket: sock,
    status: "connecting",
    qr: null,
    conversations: new Map(),
  };
  sessions.set(tid, info);

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      info.status = "qrcode";
      info.qr = qr;
      logger.info({ tenantId: tid }, "✨ QR Generado");

      await updateSessionDB(tid, {
        qr_data: qr,
        status: "qrcode",
        last_seen_at: new Date().toISOString(),
      });

      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      info.status = "connected";
      info.qr = null;

      logger.info({ tenantId: tid }, "✅ Conectado");
      let phone = sock?.user?.id ? sock.user.id.split(":")[0] : null;

      await updateSessionDB(tid, {
        status: "connected",
        qr_data: null,
        phone_number: phone,
        last_connected_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      });
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        sessions.delete(tid);
        logger.info({ tenantId: tid }, "🔄 Conexión perdida, reconectando...");
        getOrCreateSession(tid);
      } else {
        sessions.delete(tid);
        await updateSessionDB(tid, { status: "disconnected", qr_data: null });
        logger.info({ tenantId: tid }, "❌ Sesión cerrada permanentemente (Logout).");
      }
    }
  });

  sock.ev.on("creds.update", async () => { await saveCreds(); });

  sock.ev.on("messages.upsert", async (m) => {
    try {
      const msg = m.messages?.[0];
      if (!msg) return;

      logger.info({ tenantId: tid }, "[wa-server] 📩 messages.upsert recibido");

      if (!msg?.message || msg.key.fromMe) return;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid || remoteJid.includes("@g.us")) return;

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text;

      if (!text) return;

      const pushName = msg.pushName || "Cliente";
      const userPhone = remoteJid.split("@")[0];

      if (!info.conversations) info.conversations = new Map();

      let convo = info.conversations.get(userPhone);
      if (!convo) {
        convo = { history: [] };
        info.conversations.set(userPhone, convo);
      }
      const history = convo.history || [];

      const convoSession = await convoState.getOrCreateSession(tid, userPhone);
      const customerId = await getOrCreateCustomer(tid, userPhone);
      const event = buildBookingEventFromMessage(text, convoSession);

      const botApiUrl = process.env.N8N_WEBHOOK_URL;

      let replyText = null;
      let newState = null;
      let icsData = null;

      if (!botApiUrl) {
        logger.error("[wa-server] N8N_WEBHOOK_URL no está configurado.");
      } else {
        const payload = {
          tenantId: tid,
          customerId: String(customerId),
          phoneNumber: String(userPhone),
          text,
          customerName: pushName,
          state: {
            current_flow: convoSession.current_flow,
            step: convoSession.step,
            payload: convoSession.payload || {},
          },
          event,
        };

        try {
          logger.info({ tenantId: tid }, "[wa-server] Llamando a n8n (timeout 60s)");
          const response = await axios.post(botApiUrl, payload, { timeout: 60000 });

          const d = response?.data || null;

          if (d) {
            if (typeof d.data === "string") replyText = d.data;
            if (!replyText && typeof d.replyText === "string") replyText = d.replyText;
            if (!replyText && typeof d.message === "string") replyText = d.message;
            if (!replyText && typeof d.reply === "string") replyText = d.reply;
            if (d.newState) newState = d.newState;
            if (d.icsData) icsData = d.icsData;
          }

          if (replyText) logger.info({ tenantId: tid }, "[wa-server] ✅ Respuesta recibida desde n8n");
          else logger.warn({ tenantId: tid, d }, "[wa-server] ⚠️ n8n respondió pero sin texto usable");
        } catch (err) {
          logger.error(
            "[wa-server] Error al llamar a n8n:",
            err?.response?.data || err.message
          );
        }
      }

      if (!replyText) {
        logger.info({ tenantId: tid }, "[wa-server] Usando fallback de OpenAI");
        const fallback = await generateReply(text, tid, pushName, history, userPhone);
        replyText =
          fallback ||
          "Ahora mismo no puedo gestionar bien tu solicitud. Inténtalo de nuevo en unos minutos, por favor. 🙏";

        newState = {
          current_flow: convoSession.current_flow,
          step: convoSession.step,
          payload: convoSession.payload || {},
        };
      }

      if (newState) {
        try {
          await convoState.updateSession(convoSession.id, {
            current_flow: newState.current_flow,
            step: newState.step,
            payload: newState.payload,
          });
        } catch (err) {
          logger.error("[wa-server] Error al actualizar conversación:", err);
        }
      }

      await sock.sendMessage(remoteJid, { text: replyText });

      // ✅ Si n8n mandó icsData, lo mandamos también
      if (icsData) {
        const ok = await sendICS(sock, remoteJid, icsData, {
          fileName: "cita_confirmada.ics",
          caption: "📅 Toca aquí para guardar/actualizar tu cita en el calendario",
        });

        if (!ok) logger.warn({ tenantId: tid }, "⚠️ icsData llegó pero no era válido (texto/base64).");
        else logger.info({ tenantId: tid }, "✅ ICS enviado correctamente.");
      }

      history.push({ role: "user", content: text });
      history.push({ role: "assistant", content: replyText });

      const MAX_MESSAGES = 20;
      if (history.length > MAX_MESSAGES) history.splice(0, history.length - MAX_MESSAGES);

      convo.history = history;
      info.conversations.set(userPhone, convo);
    } catch (e) {
      logger.error("[wa-server] Error en messages.upsert:", e);
    }
  });

  return info;
}

// ---------------------------------------------------------------------
// 11. API ROUTES (JSON Parser Protected)
// ---------------------------------------------------------------------

app.get("/health", jsonParser, (req, res) =>
  res.json({ ok: true, active_sessions: sessions.size })
);

app.get("/sessions/:tenantId", jsonParser, async (req, res) => {
  const tenantId = String(req.params.tenantId || "");
  const info = sessions.get(tenantId);

  if (!info) {
    return res.json({
      ok: true,
      session: { id: tenantId, status: "disconnected", qr_data: null },
    });
  }

  return res.json({
    ok: true,
    session: {
      id: tenantId,
      status: info.status,
      qr_data: info.qr || null,
      phone_number: info.socket?.user?.id?.split(":")[0] || null,
    },
  });
});

// ✅ CONNECT NUCLEAR (corrige wait)
app.post("/sessions/:tenantId/connect", jsonParser, async (req, res) => {
  const tenantId = String(req.params.tenantId || "");

  try {
    await updateSessionDB(tenantId, { status: "disconnected", qr_data: null });

    const existing = sessions.get(tenantId);
    if (existing) {
      try {
        existing.socket.end(undefined);
        sessions.delete(tenantId);
      } catch (e) {
        console.error("Error cerrando socket viejo:", e);
      }
    }

    const sessionFolder = path.join(WA_SESSIONS_ROOT, tenantId);
    if (fs.existsSync(sessionFolder)) {
      try {
        fs.rmSync(sessionFolder, { recursive: true, force: true });
        await sleep(2000);
        logger.info({ tenantId }, "🗑️ Carpeta de sesión eliminada.");
      } catch (err) {
        logger.error({ tenantId, err }, "No se pudo borrar la carpeta de sesión.");
      }
    }

    await getOrCreateSession(tenantId);

    // ✅ Espera por QR o connected
    const ready = await waitForReady(tenantId, 12000);

    return res.json({
      ok: true,
      status: ready?.status || "connecting",
    });
  } catch (e) {
    console.error("[/sessions/:tenantId/connect] Error:", e);
    return res.status(500).json({
      ok: false,
      error: e.message || "Error iniciando sesión de WhatsApp",
    });
  }
});

app.post("/sessions/:tenantId/disconnect", jsonParser, async (req, res) => {
  const tenantId = String(req.params.tenantId || "");
  const s = sessions.get(tenantId);
  if (s?.socket) await s.socket.logout().catch(() => {});
  sessions.delete(tenantId);
  await updateSessionDB(tenantId, { status: "disconnected", qr_data: null });
  res.json({ ok: true });
});

app.post("/sessions/:tenantId/send-message", jsonParser, async (req, res) => {
  const tenantId = String(req.params.tenantId || "");
  const { phone, message } = req.body || {};

  if (!phone || !message) {
    return res.status(400).json({ ok: false, error: "missing_fields", detail: "Requiere phone y message" });
  }

  let session = sessions.get(tenantId);

  if (!session || session.status !== "connected") {
    try { session = await getOrCreateSession(tenantId); } catch (e) {}
  }

  session = sessions.get(tenantId);
  if (!session || session.status !== "connected") {
    return res.status(400).json({ ok: false, error: "wa_not_connected" });
  }

  const jid = String(phone).replace(/\D/g, "") + "@s.whatsapp.net";

  try {
    await session.socket.sendMessage(jid, { text: String(message) });
    logger.info({ tenantId, phone }, "✅ send-message enviado");
    return res.json({ ok: true });
  } catch (e) {
    logger.error(e, "Error en send-message");
    return res.status(500).json({ ok: false, error: "send_failed", detail: e.message });
  }
});

app.post("/sessions/:tenantId/send-template", jsonParser, async (req, res) => {
  const tenantId = String(req.params.tenantId || "");
  const { event, phone, variables } = req.body || {};

  if (!event || !phone) return res.status(400).json({ error: "Faltan datos" });

  let session = sessions.get(tenantId);
  if (!session || session.status !== "connected") {
    try { session = await getOrCreateSession(tenantId); } catch (e) {}
  }

  session = sessions.get(tenantId);
  if (!session || session.status !== "connected") {
    return res.status(400).json({ error: "Bot no conectado." });
  }

  const templateBody = await getTemplate(tenantId, event);
  if (!templateBody) return res.status(404).json({ error: `Plantilla no encontrada: ${event}` });

  const message = renderTemplate(templateBody, variables || {});
  const jid = String(phone).replace(/\D/g, "") + "@s.whatsapp.net";

  try {
    await session.socket.sendMessage(jid, { text: message });

    // ✅ ICS SOLO si date/time vienen y parsea bien
    if (event === "booking_confirmed" && variables?.date && variables?.time) {
      const context = await getTenantContext(tenantId);

      const appointmentDate = parseLocalDateTimeToDate(variables.date, variables.time);
      if (appointmentDate && !isNaN(appointmentDate.getTime())) {
        const icsBuffer = createICSFile(
          `Cita en ${context.name}`,
          `Servicio con ${variables.resource_name || "Nosotros"}.`,
          "En el local",
          appointmentDate
        );

        await session.socket.sendMessage(jid, {
          document: icsBuffer,
          mimetype: "text/calendar; charset=utf-8",
          fileName: "agendar_cita.ics",
          caption: "📅 Toca este archivo para agregar el recordatorio a tu calendario.",
        });

        logger.info({ tenantId, event, phone }, "✅ Plantilla + ICS enviados");
      } else {
        logger.warn({ tenantId, variables }, "⚠️ No pude parsear date/time para ICS en send-template");
      }
    }

    res.json({ ok: true, message });
  } catch (e) {
    logger.error(e, "Fallo enviando mensaje");
    res.status(500).json({ error: "Error envío" });
  }
});

app.post("/sessions/:tenantId/send-media", jsonParser, async (req, res) => {
  const tenantId = String(req.params.tenantId || "");
  const { phone, type, base64, fileName, mimetype, caption } = req.body || {};

  if (!phone || !base64 || !type) {
    return res.status(400).json({ error: "Faltan datos (phone, base64, type)" });
  }

  let session = sessions.get(tenantId);
  if (!session || session.status !== "connected") {
    try { session = await getOrCreateSession(tenantId); } catch (e) {}
  }

  session = sessions.get(tenantId);
  if (!session || session.status !== "connected") {
    return res.status(400).json({ error: "Bot no conectado." });
  }

  const jid = String(phone).replace(/\D/g, "") + "@s.whatsapp.net";

  try {
    const mediaBuffer = Buffer.from(String(base64), "base64");

    let messagePayload = {};

    if (type === "document") {
      messagePayload = {
        document: mediaBuffer,
        mimetype: mimetype || "application/octet-stream",
        fileName: fileName || "archivo.bin",
        caption: caption || "",
      };
    } else if (type === "image") {
      messagePayload = {
        image: mediaBuffer,
        caption: caption || "",
      };
    } else if (type === "audio") {
      messagePayload = {
        audio: mediaBuffer,
        mimetype: mimetype || "audio/mp4",
      };
    } else {
      return res.status(400).json({ error: "type inválido. Usa document|image|audio" });
    }

    await session.socket.sendMessage(jid, messagePayload);

    logger.info({ tenantId, phone, type }, "📎 Archivo enviado por API externa");
    res.json({ ok: true });
  } catch (e) {
    logger.error(e, "Error enviando media");
    res.status(500).json({ error: "Error enviando archivo: " + e.message });
  }
});

// ---------------------------------------------------------------------
// 12. AVAILABILITY
// ---------------------------------------------------------------------

app.get("/api/v1/availability", jsonParser, async (req, res) => {
  const tenantId = String(req.query.tenantId || "");
  const resourceId = req.query.resourceId ? String(req.query.resourceId) : null;
  const date = String(req.query.date || "");

  if (!tenantId || !date) return res.status(400).json({ error: "Faltan tenantId y date" });

  const requestedDate = new Date(date);
  if (isNaN(requestedDate.getTime())) {
    return res.status(400).json({ error: "Formato de fecha inválido" });
  }

  const slots = await getAvailableSlots(
    tenantId,
    resourceId,
    requestedDate,
    7
  );

  const sorted = (slots || []).sort((a, b) => a.start.getTime() - b.start.getTime());

  const formattedSlots = sorted.map((s) =>
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
    available_slots_count: sorted.length,
    available_slots: formattedSlots.slice(0, 40),
  });
});

// ---------------------------------------------------------------------
// 16. RESTORE SESSIONS
// ---------------------------------------------------------------------

async function restoreSessions() {
  try {
    logger.info("♻️ Restaurando sesiones de WhatsApp desde la base de datos...");

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
      const tenantId = String(row.tenant_id || "");
      if (!tenantId) continue;

      try {
        logger.info({ tenantId }, "🔄 Restaurando sesión previa...");
        await getOrCreateSession(tenantId);
        await updateSessionDB(tenantId, { last_seen_at: new Date().toISOString() });
      } catch (err) {
        logger.error({ tenantId, err }, "Error restaurando sesión de WhatsApp");
      }
    }
  } catch (e) {
    logger.error(e, "Fallo general en restoreSessions");
  }
}

// ---------------------------------------------------------------------
// 17. FINAL FUSION HANDLER (FIX PARA TODO)
// ---------------------------------------------------------------------

// 🛑 AQUÍ ESTÁ EL FIX FINAL PARA EL LOGIN: 
// Aseguramos que el parser de JSON no interfiere con las rutas de auth de Next.js
app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/auth")) {
    return next(); 
  }
  jsonParser(req, res, next);
});

// Sin ruta para evitar error PathError (*)
// Next.js ahora sabe dónde encontrar la web gracias a 'dir: projectRoot'
app.use(async (req, res) => {
  await handle(req, res);
});

// 🔥 ENCENDIDO DEL MOTOR HÍBRIDO
nextApp.prepare().then(() => {
  app.listen(PORT, (err) => {
    if (err) throw err;
    logger.info(`🚀 Servidor FUSIONADO (Bot + Web) escuchando en puerto ${PORT}`);
    restoreSessions().catch((e) =>
      logger.error(e, "Error al intentar restaurar sesiones al inicio")
    );
  });
}).catch((ex) => {
  console.error(ex.stack);
  process.exit(1);
});
