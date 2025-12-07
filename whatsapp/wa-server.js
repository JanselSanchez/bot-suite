require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const express = require("express");
const qrcode = require("qrcode-terminal");
const P = require("pino");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");
const path = require("path");
const fs = require("fs"); // Agregamos fs para manejar carpetas si hace falta

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
// 4. DEFINICIÓN DE TOOLS (OPENAI)
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// 5. DEFINICIÓN DE TOOLS (CEREBRO UNIVERSAL)
// ---------------------------------------------------------------------

const tools = [
  {
    type: "function",
    function: {
      name: "check_availability",
      description: "Consulta disponibilidad. Úsalo para ver huecos libres para citas o reservas.",
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
      description: "Crea una Cita, Reserva de Mesa o Pedido Programado. NO pidas serviceId si el cliente no lo especifica.",
      parameters: {
        type: "object",
        properties: {
          customerName: { type: "string" },
          phone: { type: "string" },
          startsAtISO: { type: "string" },
          notes: { type: "string", description: "Motivo de la cita, cantidad de personas (si es restaurante) o detalles." },
          serviceId: { type: "string", description: "Opcional. Solo si el cliente eligió un servicio específico del catálogo." }
        },
        required: ["phone", "startsAtISO"], 
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_catalog",
      description: "Consulta el menú, servicios o productos del negocio para dar precios y detalles.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "human_handoff",
      description: "Úsalo cuando el cliente pida hablar con una persona real o si no sabes la respuesta.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  }
];

// ---------------------------------------------------------------------
// 6. IA CON CEREBRO DINÁMICO (Lee la DB para saber qué ser)
// ---------------------------------------------------------------------

async function generateReply(text, tenantId, pushName) {
  // 1. Cargamos TODA la identidad del negocio de la DB
  const { data: profile } = await supabase
    .from("business_profiles")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const businessType = profile?.business_type || "general"; // 'restaurante', 'clinica', 'barberia', 'tienda'
  const botName = profile?.bot_name || "Asistente Virtual";
  const botTone = profile?.bot_tone || "Amable y profesional";
  const customRules = profile?.custom_instructions || "Ayuda al cliente a agendar o comprar.";
  const humanPhone = profile?.human_handoff_phone || null;

  const now = new Date();
  // Usamos la variable global TIMEZONE_LOCALE que definimos arriba (o default a SD)
  const tz = typeof TIMEZONE_LOCALE !== 'undefined' ? TIMEZONE_LOCALE : "America/Santo_Domingo";
  const currentDateStr = now.toLocaleString("es-DO", { timeZone: tz, dateStyle: "full", timeStyle: "short" });

  // 2. Construimos el Contexto según el TIPO de negocio
  let typeContext = "";
  switch (businessType) {
    case 'restaurante':
      typeContext = "Eres el host de un restaurante. Tu objetivo es RESERVAR MESAS o TOMAR PEDIDOS. Cuando agendes, en 'notes' guarda la cantidad de personas.";
      break;
    case 'clinica':
      typeContext = "Eres recepcionista médico. Tu objetivo es agendar CITAS. Sé formal y discreto. Pregunta brevemente el motivo y guárdalo en 'notes'.";
      break;
    case 'barberia':
      typeContext = "Eres el asistente de una barbería. Agenda citas. Si no especifican barbero, agenda con cualquiera.";
      break;
    default:
      typeContext = "Eres un asistente general de negocios. Tu objetivo es AGENDAR citas o responder dudas.";
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

    INSTRUCCIONES DE COMPORTAMIENTO:
    1. **Agendar es prioridad:** Si el cliente propone una hora y hay hueco, agenda de inmediato. No des vueltas innecesarias.
    2. **Catálogo/Precios:** Si preguntan "qué venden", "precio" o "menú", EJECUTA la herramienta 'get_catalog'. No inventes precios.
    3. **Datos Faltantes:** Si no tienes servicios configurados en el catálogo, NO te bloquees. Agenda la cita con 'serviceId: null' y pon en la nota lo que el cliente quiere.
    4. **Soporte Humano:** Si el cliente pide hablar con "alguien", "humano" o "soporte", usa la herramienta 'human_handoff'.
  `.trim();

  const messages = [
    { role: "system", content: systemPrompt },
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
        const args = JSON.parse(toolCall.function.arguments);
        let response;

        // A) CONSULTAR DISPONIBILIDAD
        if (fnName === "check_availability") {
          const slots = await getAvailableSlots(tenantId, null, new Date(args.requestedDate), 7);
          if (slots.length > 0) {
            // Formatear bonito la lista
            const list = slots.slice(0, 12).map((s, i) => {
              const timeStr = s.start.toLocaleString("es-DO", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: true });
              return `${i + 1}) ${timeStr}`;
            }).join("\n");
            response = JSON.stringify({ message: "Aquí tienes los horarios disponibles (pídeles que elijan el número):", slots: list });
          } else {
            response = JSON.stringify({ message: "No hay horarios disponibles para esa fecha. Dile al cliente que intente otro día." });
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
             const list = items.map(i => {
                const price = (i.price_cents / 100).toFixed(0);
                return `- ${i.name} ($${price}): ${i.description || ''}`;
             }).join("\n");
             response = JSON.stringify({ catalog: list });
          } else {
             // Si está vacío, la IA improvisa con las Custom Instructions
             response = JSON.stringify({ message: "El catálogo está vacío en el sistema. Responde basándote solo en las Reglas del Negocio (custom_instructions) o sugiere contactar al humano." });
          }
        }

        // C) CREAR CITA / RESERVA
        else if (fnName === "create_booking") {
          // Si no nos dan fecha de fin, asumimos 1 hora por defecto (lógica segura)
          const start = new Date(args.startsAtISO);
          const endISO = args.endsAtISO || new Date(start.getTime() + 60 * 60000).toISOString();

          const { data: booking, error } = await supabase.from("bookings").insert([{
            tenant_id: tenantId,
            resource_id: null, // Se asignará automáticamente o quedará null
            service_id: args.serviceId || null,
            customer_name: args.customerName || pushName,
            customer_phone: args.phone, 
            starts_at: args.startsAtISO,
            ends_at: endISO,
            status: "confirmed",
            notes: args.notes || "Agendado por Bot"
          }]).select("id").single();
          
          if (!error) {
             response = JSON.stringify({ success: true, bookingId: booking.id, message: "Reserva/Cita creada exitosamente en el sistema." });
          } else {
             response = JSON.stringify({ success: false, error: "Error guardando en base de datos: " + error.message });
          }
        }

        // D) PASAR A HUMANO
        else if (fnName === "human_handoff") {
            if (humanPhone) {
                // Formateamos el link de WhatsApp
                const clean = humanPhone.replace(/\D/g,'');
                response = JSON.stringify({ message: `Dile al cliente que puede escribir directamente a nuestro encargado aquí: https://wa.me/${clean}` });
            } else {
                response = JSON.stringify({ message: "No tengo un número de contacto directo configurado. Dile que deje su mensaje y lo contactaremos." });
            }
        }
        
        // E) REAGENDAR / CANCELAR (Stub simple)
        else if (fnName === "reschedule_booking" || fnName === "cancel_booking") {
             response = JSON.stringify({ success: true, message: "Dile al cliente que la operación se realizó (simulación)." });
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

    return message.content.trim();
  } catch (err) {
    logger.error("Error OpenAI:", err);
    return null;
  }
}

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: cleanText },
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
            const formattedSlots = slots
              .slice(0, 15)
              .map((s) =>
                s.start.toLocaleString("es-DO", {
                  weekday: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: true,
                })
              )
              .join(", ");
            functionResponse = JSON.stringify({
              available_slots: formattedSlots,
            });
          } else {
            functionResponse = JSON.stringify({
              available_slots:
                "No hay horarios disponibles. (Verifica si la tienda cerró)",
            });
          }
        } else if (functionName === "create_booking") {
          const finalResourceId = functionArgs.resourceId || null;
          const finalCustomerName =
            functionArgs.customerName || pushName || "Cliente WhatsApp";

          const { data: booking, error } = await supabase
            .from("bookings")
            .insert([
              {
                tenant_id: tenantId,
                service_id: functionArgs.serviceId || null,
                resource_id: finalResourceId,
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
            functionResponse = JSON.stringify({
              success: true,
              bookingId: booking.id,
              assignedName: finalCustomerName,
            });
          } else {
            functionResponse = JSON.stringify({
              success: false,
              error: error?.message,
            });
          }
        } else if (
          functionName === "reschedule_booking" ||
          functionName === "cancel_booking"
        ) {
          const cleanPhone = functionArgs.customerPhone.replace(/\D/g, "");
          const whatsappPhone = `whatsapp:+${cleanPhone}`;

          let query = supabase
            .from("bookings")
            .select("id")
            .eq("tenant_id", tenantId)
            .or(
              `customer_phone.eq.${functionArgs.customerPhone},customer_phone.eq.${whatsappPhone},customer_phone.eq.${cleanPhone}`
            )
            .in("status", ["confirmed", "pending"]);

          if (functionArgs.oldBookingDate)
            query = query.eq("starts_at", functionArgs.oldBookingDate);
          if (functionArgs.bookingDate)
            query = query.eq("starts_at", functionArgs.bookingDate);

          const { data: targetBooking } = await query.maybeSingle();

          if (targetBooking) {
            let err;
            if (functionName === "cancel_booking") {
              ({ error: err } = await supabase
                .from("bookings")
                .update({ status: "cancelled" })
                .eq("id", targetBooking.id));
            } else {
              ({ error: err } = await supabase
                .from("bookings")
                .update({
                  starts_at: functionArgs.newStartsAtISO,
                  ends_at: functionArgs.newEndsAtISO,
                })
                .eq("id", targetBooking.id));
            }
            functionResponse = JSON.stringify({ success: !err });
          } else {
            functionResponse = JSON.stringify({
              success: false,
              error: "No encontré la cita. Verifica el número y la fecha.",
            });
          }
        }

        messages.push({
          tool_call_id: toolCall.id,
          role: "tool",
          name: functionName,
          content: functionResponse,
        });
      }

      const secondResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
      });

      return secondResponse.choices[0].message.content.trim();
    }

    return completion.choices[0].message.content.trim();
  } catch (err) {
    logger.error("Error OpenAI:", err);
    return null;
  }


// ---------------------------------------------------------------------
// 6. ACTUALIZAR ESTADO DB
// ---------------------------------------------------------------------

async function updateSessionDB(tenantId, updateData) {
  if (!tenantId) return;

  try {
    // 1) Ver si ya existe una fila para este tenant
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

    // 2) Si existe, hacemos UPDATE; si no, INSERT
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

    // 3) Sincronizamos también la columna wa_connected en tenants (si viene status)
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
// 7. AUTH STATE MONOLÍTICO
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

  // Nos aseguramos de que la carpeta exista
  if (!fs.existsSync(sessionFolder)) {
    fs.mkdirSync(sessionFolder, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
  return { state, saveCreds };
}

// ---------------------------------------------------------------------
// 8. CORE WHATSAPP
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

    const pushName = msg.pushName || "Cliente";

    const reply = await generateReply(text, tenantId, pushName);
    if (reply) {
      await sock.sendMessage(remoteJid, { text: reply });
    }
  });

  return info;
}

// ---------------------------------------------------------------------
// 9. API ROUTES BÁSICAS
// ---------------------------------------------------------------------

app.get("/health", (req, res) =>
  res.json({ ok: true, active_sessions: sessions.size })
);

// 🔥🔥🔥 RUTA NUEVA: Esta es la que devuelve el QR a la web 🔥🔥🔥
app.get("/sessions/:tenantId", async (req, res) => {
  const tenantId = req.params.tenantId;
  const info = sessions.get(tenantId);

  // Si no está en memoria, asumimos desconectado
  if (!info) {
    return res.json({ 
      ok: true, 
      session: { 
        id: tenantId, 
        status: "disconnected", 
        qr_data: null 
      } 
    });
  }

  return res.json({
    ok: true,
    session: {
      id: tenantId,
      status: info.status,
      qr_data: info.qr || null, // Aquí va el string del QR
      phone_number: info.socket?.user?.id?.split(":")[0] || null
    }
  });
});
// ---------------------------------------------------------------------

// 👉 Endpoint para iniciar/conectar la sesión de un tenant (botón "Conectar")
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
// 10. API DE CONSULTA DE DISPONIBILIDAD
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
// 11. API DE CREACIÓN DE CITA
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
// 12. API DE REAGENDAMIENTO
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
// 13. API DE CANCELACIÓN
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
// 14. AUTO-RECONEXIÓN (restoreSessions)
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
// 15. START SERVER
// ---------------------------------------------------------------------

app.listen(PORT, () => {
  logger.info(`🚀 WA server escuchando en puerto ${PORT}`);
  restoreSessions().catch((e) =>
    logger.error(e, "Error al intentar restaurar sesiones al inicio")
  );
});