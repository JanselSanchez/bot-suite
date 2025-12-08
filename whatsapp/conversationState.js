// whatsapp/conversationState.js
// Persistencia de flujo de conversación en Supabase
// Tablas usadas:
//  - customers
//  - conversation_sessions

const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.warn("[conversationState] Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en env.");
}

const supabase = createClient(supabaseUrl, serviceKey);

/**
 * Normaliza el teléfono a solo dígitos.
 */
function normalizePhone(phone) {
  if (!phone) return null;
  return String(phone).replace(/\D/g, "");
}

/**
 * Crea o devuelve un customer + session para (tenantId, phone).
 * Devuelve siempre un objeto de sesión:
 * {
 *   id,
 *   tenant_id,
 *   phone_number,
 *   current_flow,
 *   step,
 *   payload
 * }
 */
async function getOrCreateSession(tenantId, phoneNumber) {
  const cleanPhone = normalizePhone(phoneNumber);
  if (!tenantId || !cleanPhone) {
    throw new Error("[getOrCreateSession] tenantId y phoneNumber son requeridos");
  }

  // 1) Asegurar customer
  let customerId = null;
  try {
    const { data: existingCustomer, error: customerErr } = await supabase
      .from("customers")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("phone_number", cleanPhone)
      .maybeSingle();

    if (customerErr) {
      console.error("[getOrCreateSession] Error buscando customer:", customerErr);
    }

    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      const { data: newCustomer, error: insertCustomerErr } = await supabase
        .from("customers")
        .insert([
          {
            tenant_id: tenantId,
            phone_number: cleanPhone,
          },
        ])
        .select("id")
        .single();

      if (insertCustomerErr) {
        console.error("[getOrCreateSession] Error insertando customer:", insertCustomerErr);
      } else {
        customerId = newCustomer.id;
      }
    }
  } catch (e) {
    console.error("[getOrCreateSession] Error general en customers:", e);
  }

  // 2) Buscar session existente
  let sessionRow = null;
  try {
    const { data: existingSession, error: sessionErr } = await supabase
      .from("conversation_sessions")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("phone_number", cleanPhone)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sessionErr) {
      console.error("[getOrCreateSession] Error buscando session:", sessionErr);
    }

    if (existingSession) {
      // Normalizamos payload
      const payload =
        typeof existingSession.payload === "string"
          ? safeJsonParse(existingSession.payload)
          : existingSession.payload || {};

      sessionRow = {
        ...existingSession,
        payload,
      };
    }
  } catch (e) {
    console.error("[getOrCreateSession] Error general en sessions:", e);
  }

  // 3) Si no hay session, crear una nueva
  if (!sessionRow) {
    try {
      const now = new Date().toISOString();
      const base = {
        tenant_id: tenantId,
        phone_number: cleanPhone,
        current_flow: null,
        step: null,
        payload: {},
        created_at: now,
        updated_at: now,
      };

      const { data: newSession, error: insertSessionErr } = await supabase
        .from("conversation_sessions")
        .insert([base])
        .select("*")
        .single();

      if (insertSessionErr) {
        console.error("[getOrCreateSession] Error creando session:", insertSessionErr);
        throw insertSessionErr;
      }

      sessionRow = {
        ...newSession,
        payload: newSession.payload || {},
      };
    } catch (e) {
      console.error("[getOrCreateSession] Error final creando session:", e);
      throw e;
    }
  }

  return sessionRow;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

/**
 * Actualiza la sesión.
 * Permite dos formas:
 *  - updateSession(sessionId, fields)
 *  - updateSession(sessionObject, fields)  (usa sessionObject.id)
 *
 * Los campos permitidos típicos:
 *  - current_flow (string | null)
 *  - step (string | null)
 *  - payload (object)
 */
async function updateSession(sessionOrId, fields = {}) {
  if (!sessionOrId) return;

  const sessionId = typeof sessionOrId === "string" ? sessionOrId : sessionOrId.id;
  if (!sessionId) {
    console.warn("[updateSession] Sin sessionId, no se puede actualizar");
    return;
  }

  const patch = { ...fields, updated_at: new Date().toISOString() };

  // Si payload viene como objeto, lo guardamos como JSON.
  if (patch.payload && typeof patch.payload === "object") {
    patch.payload = patch.payload;
  }

  try {
    const { error } = await supabase
      .from("conversation_sessions")
      .update(patch)
      .eq("id", sessionId);

    if (error) {
      console.error("[updateSession] Error actualizando session:", error);
    }
  } catch (e) {
    console.error("[updateSession] Error general:", e);
  }
}

module.exports = {
  getOrCreateSession,
  updateSession,
};
