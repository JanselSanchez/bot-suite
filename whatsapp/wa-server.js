require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const express = require("express");
const qrcode = require("qrcode-terminal");
const P = require("pino");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");
const path = require("path");
const fs = require("fs");

// Importaciones de Date-fns
const { startOfWeek, addDays, startOfDay } = require("date-fns");

// ---------------------------------------------------------------------
// CONFIGURACIÓN GLOBAL
// ---------------------------------------------------------------------

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 4001;

// 🔥 AJUSTE DE ZONA HORARIA (CRÍTICO)
// Sumamos 4 horas para que el servidor UTC coincida con la hora de apertura en RD (UTC-4)
const SERVER_OFFSET_HOURS = 4;

// Timezone configurable (fallback RD)
const TIMEZONE_LOCALE = process.env.TIMEZONE_LOCALE || "America/Santo_Domingo";

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

/**
 * sessions: Map<tenantId, {
 *   tenantId,
 *   socket,
 *   status,
 *   qr,
 *   conversations: Map<phone, { history: Array<{role, content}> }>
 * }>
 */
const sessions = new Map();

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
      const { h: closeH, m: closeM } = hmsToParts(
        toHHMM(dayConfig.close_time)
      );

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
        return (
          cursor.getTime() < busyEnd.getTime() &&
          slotEnd.getTime() > busyStart.getTime()
        );
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

// ---------------------------------------------------------------------
// 2. HELPERS: CALENDARIO Y ARCHIVOS (.ICS)
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

async function getAvailableSlots(
  tenantId,
  resourceId,
  startDate,
  daysToLookAhead = 7
) {
  if (!tenantId) return [];

  const weekStart = startOfWeek(startDate, { weekStartsOn: 1 });
  const weekEnd = addDays(weekStart, daysToLookAhead);

  const { data: hours } = await supabase
    .from("business_hours")
    .select("dow, is_closed, open_time, close_time")
    .eq("tenant_id", tenantId)
    .eq("is_closed", false)
    .order("dow", { ascending: true });

  let bookingsQuery = supabase
    .from("bookings")
    .select("starts_at, ends_at, resource_id, status")
    .eq("tenant_id", tenantId)
    .gte("starts_at", startOfDay(startDate).toISOString())
    .lt("ends_at", addDays(weekEnd, 1).toISOString())
    .in("status", ["confirmed", "pending"]);

  if (resourceId) {
    bookingsQuery = bookingsQuery.eq("resource_id", resourceId);
  }
  const { data: bookings } = await bookingsQuery;

  const openWindows = weeklyOpenWindows(weekStart, hours || []);

  const offerableSlots = generateOfferableSlots(
    openWindows,
    bookings || [],
    30
  );

  return offerableSlots.filter((slot) => slot.start >= startDate);
}

// ---------------------------------------------------------------------
// 4. INTENT_KEYWORDS ENGINE
// ---------------------------------------------------------------------

function normalizeForIntent(str = "") {
  return str
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quitar acentos
    .toLowerCase()
    .trim();
}

/**
 * Lee intent_keywords y devuelve un resumen JSON de las intenciones detectadas.
 */
async function buildIntentHints(tenantId, userText) {
  try {
    const normalizedUser = normalizeForIntent(userText);

    const { data, error } = await supabase
      .from("intent_keywords")
      .select("intent, frase, peso, es_error, locale, term, tenant_id")
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`);

    if (error || !data || data.length === 0) {
      return "";
    }

    const scores = {}; // intent -> { score, terms: Set<string> }

    for (const row of data) {
      // Filtrar por locale si viene
      if (
        row.locale &&
        normalizeForIntent(row.locale) !== normalizeForIntent("es-DO") &&
        normalizeForIntent(row.locale) !== normalizeForIntent("es")
      ) {
        continue;
      }

      if (row.es_error) continue; // ignoramos ejemplos marcados como error

      const term = row.term || row.frase;
      if (!term) continue;

      const normTerm = normalizeForIntent(term);
      if (!normTerm) continue;

      if (normalizedUser.includes(normTerm)) {
        const intent = row.intent || "desconocido";
        if (!scores[intent]) {
          scores[intent] = {
            intent,
            score: 0,
            terms: new Set(),
          };
        }
        const peso = typeof row.peso === "number" ? row.peso : 1;
        scores[intent].score += peso;
        scores[intent].terms.add(term);
      }
    }

    const intentsArr = Object.values(scores);
    if (intentsArr.length === 0) return "";

    // Ordenar por score desc y limitar a top 3
    intentsArr.sort((a, b) => b.score - a.score);
    const topIntents = intentsArr.slice(0, 3).map((i) => ({
      intent: i.intent,
      score: i.score,
      terms: Array.from(i.terms),
    }));

    return JSON.stringify({
      engine: "intent_keywords",
      intents: topIntents,
    });
  } catch (e) {
    console.error("[buildIntentHints] error:", e);
    return "";
  }
}

// ---------------------------------------------------------------------
// 5. DEFINICIÓN DE TOOLS (CEREBRO UNIVERSAL)
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
        properties: {
          requestedDate: { type: "string", description: "Fecha ISO base." },
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
        "Crea una Cita, Reserva de Mesa o Pedido Programado. NO pidas serviceId si el cliente no lo especifica.",
      parameters: {
        type: "object",
        properties: {
          customerName: { type: "string" },
          phone: { type: "string" },
          startsAtISO: { type: "string" },
          endsAtISO: { type: "string" },
          notes: {
            type: "string",
            description:
              "Motivo de la cita, cantidad de personas (si es restaurante) o detalles.",
          },
          serviceId: {
            type: "string",
            description:
              "Opcional. Solo si el cliente eligió un servicio específico del catálogo.",
          },
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
          customerPhone: {
            type: "string",
            description: "Teléfono del cliente (WhatsApp).",
          },
          newStartsAtISO: {
            type: "string",
            description: "Nueva fecha/hora inicio en formato ISO 8601.",
          },
          newEndsAtISO: {
            type: "string",
            description:
              "Nueva fecha/hora fin en formato ISO 8601. Opcional; si no se envía se asume 1 hora.",
          },
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
        properties: {
          customerPhone: {
            type: "string",
            description: "Teléfono del cliente (WhatsApp).",
          },
        },
        required: ["customerPhone"],
      },
    },
  },
];

// ---------------------------------------------------------------------
// 6. IA CON CEREBRO DINÁMICO (Lee la DB para saber qué ser)
// ---------------------------------------------------------------------

/**
 * historyMessages: array de mensajes previos [{role, content}] del chat con ese cliente.
 * userPhone: número de WhatsApp SIN @s.whatsapp.net
 */
async function generateReply(
  text,
  tenantId,
  pushName,
  historyMessages = [],
  userPhone = null
) {
  // 1. Cargamos TODA la identidad del negocio de la DB
  const { data: profile } = await supabase
    .from("business_profiles")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const businessType = profile?.business_type || "general"; // 'restaurante', 'clinica', 'barberia', 'tienda'
  const botName = profile?.bot_name || "Asistente Virtual";
  const botTone = profile?.bot_tone || "Amable y profesional";
  const customRules =
    profile?.custom_instructions || "Ayuda al cliente a agendar o comprar.";
  const humanPhone = profile?.human_handoff_phone || null;

  const now = new Date();
  const tz = TIMEZONE_LOCALE || "America/Santo_Domingo";
  const currentDateStr = now.toLocaleString("es-DO", {
    timeZone: tz,
    dateStyle: "full",
    timeStyle: "short",
  });

  // 2. Intentos detectados por intent_keywords
  const intentHints = await buildIntentHints(tenantId, text);

  // 3. Construimos el Contexto según el TIPO de negocio
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
    - Teléfono WhatsApp del cliente (úsalo SIEMPRE como "phone" / "customerPhone" en las herramientas): ${userPhone || "desconocido"}.
    - INTENTOS DETECTADOS POR PALABRAS CLAVE (intent_keywords): ${
      intentHints || "ninguno claro"
    }.

    INTERPRETACIÓN DE INTENTOS:
    - Si intent_keywords indica claramente algo como "reservar", "reprogramar", "cancelar" o "disponibilidad",
      úsalo como pista fuerte para decidir qué herramienta usar primero.
    - No contradigas el contenido literal del mensaje del cliente; úsalo como refuerzo.

    INSTRUCCIONES DE COMPORTAMIENTO:
    1. **Agendar es prioridad:** Si el cliente propone una hora y hay hueco, agenda de inmediato. No des vueltas innecesarias.
    2. **Catálogo/Precios:** Si preguntan "qué venden", "precio" o "menú", EJECUTA la herramienta 'get_catalog'. No inventes precios.
    3. **Datos Faltantes:** Si no tienes servicios configurados en el catálogo, NO te bloquees. Agenda la cita con 'serviceId: null' y pon en la nota lo que el cliente quiere.
    4. **Soporte Humano:** Si el cliente pide hablar con "alguien", "humano" o "soporte", usa la herramienta 'human_handoff'.
    5. **Listas de horarios:** Cuando uses 'check_availability' recibirás un JSON con 'slots', cada uno con:
       - index (1,2,3,...)
       - label (texto amigable para mostrar al cliente)
       - isoStart (fecha/hora en ISO 8601)
       Debes mostrar al cliente la lista usando 'label' y decirle que elija un número.
    6. **Interpretar opciones:** Si el cliente dice "opción 3", "la 3", "la número 2", etc. DESPUÉS de haber visto una lista de horarios, SIEMPRE se refiere a esos 'slots', NO a productos del catálogo. Debes tomar el slot correspondiente por 'index' y llamar a 'create_booking' con:
       - phone = "${userPhone || "el número del cliente en WhatsApp"}"
       - startsAtISO = isoStart del slot elegido
    7. **Confirmaciones vagas:** Si tú acabas de proponer un horario concreto (por ejemplo "12:00 p. m.") y el cliente responde "sí", "está bien", "perfecto", etc., interpreta eso como confirmación y llama de inmediato a 'create_booking' usando esa última hora acordada. No vuelvas a preguntar lo mismo.
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

    // --- MANEJO DE TOOLS ---
    if (message.tool_calls) {
      messages.push(message);

      for (const toolCall of message.tool_calls) {
        const fnName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments || "{}");
        let response;

        // A) CONSULTAR DISPONIBILIDAD
        if (fnName === "check_availability") {
          const rawSlots = await getAvailableSlots(
            tenantId,
            null,
            new Date(args.requestedDate),
            7
          );

          // 🔥 Ordenamos cronológicamente
          const sortedSlots = (rawSlots || []).sort(
            (a, b) => a.start.getTime() - b.start.getTime()
          );

          if (sortedSlots.length > 0) {
            // "Trampa" ISO: devolvemos estructura rica para que la IA pueda mapear número → ISO
            const slotObjects = sortedSlots.slice(0, 12).map((s, i) => {
              const timeStr = s.start.toLocaleString("es-DO", {
                timeZone: tz,
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
                "Aquí tienes los horarios disponibles (el cliente elegirá por número). Usa SIEMPRE 'index' + 'isoStart' para agendar.",
              slots: slotObjects,
              plain_list: listText,
            });
          } else {
            response = JSON.stringify({
              message:
                "No hay horarios disponibles para esa fecha. Dile al cliente que intente otro día.",
              slots: [],
            });
          }
        }

        // B) CONSULTAR CATÁLOGO (Universal)
        else if (fnName === "get_catalog") {
          const { data: items } = await supabase
            .from("items")
            .select("name, price_cents, description, type")
            .eq("tenant_id", tenantId)
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
                "El catálogo está vacío en el sistema. Responde basándote solo en las Reglas del Negocio (custom_instructions) o sugiere contactar al humano.",
            });
          }
        }

        // C) CREAR CITA / RESERVA
        else if (fnName === "create_booking") {
          const phoneArg = args.phone || userPhone;
          const startsISO = args.startsAtISO;

          if (!phoneArg || !startsISO) {
            response = JSON.stringify({
              success: false,
              error:
                "missing_phone_or_start: falta phone o startsAtISO para crear la cita.",
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
                  tenant_id: tenantId,
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

            if (!error) {
              response = JSON.stringify({
                success: true,
                bookingId: booking.id,
                message: "Reserva/Cita creada exitosamente en el sistema.",
              });
            } else {
              response = JSON.stringify({
                success: false,
                error:
                  "Error guardando en base de datos: " +
                  (error?.message || "desconocido"),
              });
            }
          }
        }

        // D) PASAR A HUMANO
        else if (fnName === "human_handoff") {
          if (humanPhone) {
            const clean = humanPhone.replace(/\D/g, "");
            response = JSON.stringify({
              message: `Dile al cliente que puede escribir directamente a nuestro encargado aquí: https://wa.me/${clean}`,
            });
          } else {
            response = JSON.stringify({
              message:
                "No tengo un número de contacto directo configurado. Dile que deje su mensaje y lo contactaremos.",
            });
          }
        }

        // E) REAGENDAR (REAL)
        else if (fnName === "reschedule_booking") {
          const phoneFilter =
            args.customerPhone || args.phone || userPhone || null;

          if (!phoneFilter) {
            response = JSON.stringify({
              success: false,
              error:
                "missing_phone: necesito el teléfono del cliente para reagendar.",
            });
          } else {
            const { data: booking } = await supabase
              .from("bookings")
              .select("id")
              .eq("tenant_id", tenantId)
              .eq("customer_phone", phoneFilter)
              .in("status", ["confirmed", "pending"])
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (booking) {
              const newStart = args.newStartsAtISO;
              const newEnd =
                args.newEndsAtISO ||
                new Date(new Date(newStart).getTime() + 60 * 60000).toISOString();

              const { error } = await supabase
                .from("bookings")
                .update({ starts_at: newStart, ends_at: newEnd })
                .eq("id", booking.id);

              if (!error) {
                response = JSON.stringify({
                  success: true,
                  message: "Cita reagendada correctamente.",
                });
              } else {
                response = JSON.stringify({
                  success: false,
                  error: "Error actualizando la cita en base de datos.",
                });
              }
            } else {
              response = JSON.stringify({
                success: false,
                error:
                  "No encontré ninguna cita activa con ese número de teléfono.",
              });
            }
          }
        }

        // F) CANCELAR (REAL)
        else if (fnName === "cancel_booking") {
          const phoneFilter =
            args.customerPhone || args.phone || userPhone || null;

          if (!phoneFilter) {
            response = JSON.stringify({
              success: false,
              error:
                "missing_phone: necesito el teléfono del cliente para cancelar.",
            });
          } else {
            const { data: booking } = await supabase
              .from("bookings")
              .select("id")
              .eq("tenant_id", tenantId)
              .eq("customer_phone", phoneFilter)
              .in("status", ["confirmed", "pending"])
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (booking) {
              const { error } = await supabase
                .from("bookings")
                .update({ status: "cancelled" })
                .eq("id", booking.id);

              if (!error) {
                response = JSON.stringify({
                  success: true,
                  message: "Cita cancelada correctamente.",
                });
              } else {
                response = JSON.stringify({
                  success: false,
                  error: "Error cancelando la cita.",
                });
              }
            } else {
              response = JSON.stringify({
                success: false,
                error: "No encontré ninguna cita activa para cancelar.",
              });
            }
          }
        }

        messages.push({
          tool_call_id: toolCall.id,
          role: "tool",
          name: fnName,
          content: response,
        });
      }

      // Segunda llamada a OpenAI con los resultados de las herramientas
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
// 7. ACTUALIZAR ESTADO DB
// ---------------------------------------------------------------------

async function updateSessionDB(tenantId, updateData) {
  if (!tenantId) return;

  try {
    const { data: existing, error: selectError } = await supabase
      .from("whatsapp_sessions")
      .select("id")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (selectError) {
      console.error(
        "[updateSessionDB] Error select whatsapp_sessions:",
        selectError
      );
      return;
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from("whatsapp_sessions")
        .update(updateData)
        .eq("tenant_id", tenantId);

      if (updateError) {
        console.error(
          "[updateSessionDB] Error update whatsapp_sessions:",
          updateError
        );
      }
    } else {
      const row = {
        tenant_id: tenantId,
        ...updateData,
      };

      const { error: insertError } = await supabase
        .from("whatsapp_sessions")
        .insert([row]);

      if (insertError) {
        console.error(
          "[updateSessionDB] Error insert whatsapp_sessions:",
          insertError
        );
      }
    }

    if (updateData.status) {
      const isConnected = updateData.status === "connected";
      const { error: tenantError } = await supabase
        .from("tenants")
        .update({ wa_connected: isConnected })
        .eq("id", tenantId);

      if (tenantError) {
        console.error(
          "[updateSessionDB] Error update tenants.wa_connected:",
          tenantError
        );
      }
    }
  } catch (e) {
    console.error("[updateSessionDB] Error inesperado:", e);
  }
}

// ---------------------------------------------------------------------
// 8. AUTH STATE MONOLÍTICO
// ---------------------------------------------------------------------

const WA_SESSIONS_ROOT =
  process.env.WA_SESSIONS_DIR || path.join(__dirname, ".wa-sessions");

/**
 * Wrapper sobre useMultiFileAuthState de Baileys.
 * Crea una carpeta por tenant dentro de .wa-sessions (o la que definas).
 */
async function useSupabaseAuthState(tenantId) {
  if (!tenantId) throw new Error("useSupabaseAuthState requiere tenantId");

  const { useMultiFileAuthState } = await import("@whiskeysockets/baileys");

  const sessionFolder = path.join(WA_SESSIONS_ROOT, String(tenantId));

  if (!fs.existsSync(sessionFolder)) {
    fs.mkdirSync(sessionFolder, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
  return { state, saveCreds };
}

// ---------------------------------------------------------------------
// 9. CORE WHATSAPP
// ---------------------------------------------------------------------

async function getOrCreateSession(tenantId) {
  const existing = sessions.get(tenantId);
  if (existing && existing.socket) return existing;

  logger.info({ tenantId }, "🔌 Iniciando Socket...");

  const { default: makeWASocket, DisconnectReason } = await import(
    "@whiskeysockets/baileys"
  );

  const { state, saveCreds } = await useSupabaseAuthState(tenantId);

  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ["PymeBot", "Chrome", "1.0.0"],
    syncFullHistory: false,
    connectTimeoutMs: 60000,
  });

  const info = {
    tenantId,
    socket: sock,
    status: "connecting",
    qr: null,
    conversations: new Map(), // phone -> { history: [...] }
  };
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
        });
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages?.[0];
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

    // --- Memoria por conversación (teléfono) ---
    if (!info.conversations) {
      info.conversations = new Map();
    }
    let convo = info.conversations.get(userPhone);
    if (!convo) {
      convo = { history: [] };
      info.conversations.set(userPhone, convo);
    }

    const history = convo.history || [];

    const reply = await generateReply(
      text,
      tenantId,
      pushName,
      history,
      userPhone
    );
    if (reply) {
      await sock.sendMessage(remoteJid, { text: reply });

      // Actualizamos historial: user + assistant
      history.push({ role: "user", content: text });
      history.push({ role: "assistant", content: reply });

      // Limitamos tamaño del historial (por ejemplo, últimas 10 interacciones = 20 mensajes)
      const MAX_MESSAGES = 20;
      if (history.length > MAX_MESSAGES) {
        history.splice(0, history.length - MAX_MESSAGES);
      }

      convo.history = history;
      info.conversations.set(userPhone, convo);
    }
  });

  return info;
}

// ---------------------------------------------------------------------
// 10. API ROUTES BÁSICAS
// ---------------------------------------------------------------------

app.get("/health", (req, res) =>
  res.json({ ok: true, active_sessions: sessions.size })
);

// Ruta para que el dashboard lea estado y QR
app.get("/sessions/:tenantId", async (req, res) => {
  const tenantId = req.params.tenantId;
  const info = sessions.get(tenantId);

  if (!info) {
    return res.json({
      ok: true,
      session: {
        id: tenantId,
        status: "disconnected",
        qr_data: null,
      },
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

// Endpoint para iniciar/conectar la sesión de un tenant
app.post("/sessions/:tenantId/connect", async (req, res) => {
  const tenantId = req.params.tenantId;

  try {
    const info = await getOrCreateSession(tenantId);

    return res.json({
      ok: true,
      status: info.status || "connecting",
    });
  } catch (e) {
    console.error("[/sessions/:tenantId/connect] Error:", e);
    return res.status(500).json({
      ok: false,
      error: e.message || "Error iniciando sesión de WhatsApp",
    });
  }
});

app.post("/sessions/:tenantId/disconnect", async (req, res) => {
  const s = sessions.get(req.params.tenantId);
  if (s?.socket) await s.socket.logout().catch(() => {});
  sessions.delete(req.params.tenantId);
  await updateSessionDB(req.params.tenantId, {
    status: "disconnected",
    qr_data: null,
  });
  res.json({ ok: true });
});

/**
 * ENDPOINT: Envía plantilla + archivo ICS
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

  const templateBody = await getTemplate(tenantId, event);
  if (!templateBody) {
    return res
      .status(404)
      .json({ error: `Plantilla no encontrada: ${event}` });
  }

  const message = renderTemplate(templateBody, variables || {});
  const jid = phone.replace(/\D/g, "") + "@s.whatsapp.net";

  try {
    await session.socket.sendMessage(jid, { text: message });

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

        logger.info(
          { tenantId, event, phone },
          "✅ Plantilla + ICS enviados correctamente"
        );
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
// 11. API DE CONSULTA DE DISPONIBILIDAD
// ---------------------------------------------------------------------

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

  // Ordenamos también aquí, por si acaso
  const sorted = (slots || []).sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );

  const formattedSlots = sorted.map(
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
    available_slots_count: sorted.length,
    available_slots: formattedSlots.slice(0, 40),
  });
});

// ---------------------------------------------------------------------
// 12. API DE CREACIÓN DE CITA
// ---------------------------------------------------------------------

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

  if (!tenantId || !phone || !startsAtISO || !endsAtISO) {
    return res.status(400).json({
      ok: false,
      error: "missing_fields",
      detail:
        "Requiere tenantId, phone, startsAtISO y endsAtISO. CustomerName es opcional.",
    });
  }

  const finalName = customerName || "Cliente Web";

  const { data: booking, error } = await supabase
    .from("bookings")
    .insert([
      {
        tenant_id: tenantId,
        service_id: serviceId || null,
        resource_id: resourceId || null,
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

  try {
    const session = await getOrCreateSession(tenantId);
    if (session && session.status === "connected") {
      const context = await getTenantContext(tenantId);

      const jid = String(phone).replace(/\D/g, "") + "@s.whatsapp.net";

      const startsDate = new Date(startsAtISO);
      const dateStr = startsDate.toISOString().slice(0, 10);
      const timeStr = startsDate.toTimeString().slice(0, 5);

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
// 13. API DE REAGENDAMIENTO
// ---------------------------------------------------------------------

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
// 14. API DE CANCELACIÓN
// ---------------------------------------------------------------------

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
// 15. AUTO-RECONEXIÓN (restoreSessions)
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
      const tenantId = row.tenant_id;
      try {
        logger.info({ tenantId }, "🔄 Restaurando sesión previa...");
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
// 16. START SERVER
// ---------------------------------------------------------------------

app.listen(PORT, () => {
  logger.info(`🚀 WA server escuchando en puerto ${PORT}`);
  restoreSessions().catch((e) =>
    logger.error(e, "Error al intentar restaurar sesiones al inicio")
  );
});
