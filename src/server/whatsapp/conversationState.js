// whatsapp/conversationState.js
//
// Helper para manejar conversation_sessions desde el servidor de WhatsApp.
//
// - getOrCreateSession(tenantId, phoneNumber)
// - updateSession(sessionId, patch)
//
// Esto se usa desde wa-server.js:
//   1) recibes el mensaje
//   2) resuelves tenantId + phoneNumber
//   3) llamas a getOrCreateSession(...)
//   4) envías estado al backend / bookingFlow
//   5) después de procesar respuesta, llamas a updateSession(...)
//

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "[conversationState] Faltan variables NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno."
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
  },
});

/**
 * Obtiene o crea una sesión de conversación para un tenant + phoneNumber.
 *
 * Devuelve la fila completa de conversation_sessions.
 */
async function getOrCreateSession(tenantId, phoneNumber) {
  if (!tenantId || !phoneNumber) {
    throw new Error(
      "[conversationState] tenantId y phoneNumber son obligatorios."
    );
  }

  // 1) Buscar sesión existente
  const { data, error } = await supabase
    .from("conversation_sessions")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("phone_number", phoneNumber)
    .maybeSingle();

  if (error) {
    console.error("[conversationState] Error al buscar sesión:", error);
    throw error;
  }

  if (data) {
    return data;
  }

  // 2) No existe → crear nueva sesión
  const now = new Date().toISOString();

  const { data: created, error: insertError } = await supabase
    .from("conversation_sessions")
    .insert({
      tenant_id: tenantId,
      phone_number: phoneNumber,
      current_flow: null,
      step: null,
      payload: {},
      created_at: now,
      updated_at: now,
      last_message_at: now,
    })
    .select("*")
    .single();

  if (insertError) {
    console.error("[conversationState] Error al crear sesión:", insertError);
    throw insertError;
  }

  return created;
}

/**
 * Actualiza una sesión ya existente.
 *
 * patch puede incluir:
 *  - current_flow
 *  - step
 *  - payload (objeto serializable)
 */
async function updateSession(sessionId, patch) {
  if (!sessionId) {
    throw new Error("[conversationState] sessionId es obligatorio en updateSession.");
  }

  const updateFields = {
    updated_at: new Date().toISOString(),
    last_message_at: new Date().toISOString(),
  };

  if (Object.prototype.hasOwnProperty.call(patch, "current_flow")) {
    updateFields.current_flow = patch.current_flow;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "step")) {
    updateFields.step = patch.step;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "payload")) {
    updateFields.payload = patch.payload;
  }

  const { data, error } = await supabase
    .from("conversation_sessions")
    .update(updateFields)
    .eq("id", sessionId)
    .select("*")
    .single();

  if (error) {
    console.error("[conversationState] Error al actualizar sesión:", error);
    throw error;
  }

  return data;
}

module.exports = {
  supabase,
  getOrCreateSession,
  updateSession,
};
