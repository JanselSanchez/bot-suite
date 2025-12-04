// whatsapp/utils/wa-server/supabaseAuthState.mjs
import { initAuthCreds, BufferJSON, proto } from "@whiskeysockets/baileys";

/**
 * Maneja el auth_state de Baileys guardándolo en la tabla `whatsapp_sessions`
 * por `tenant_id`, de forma que sobreviva a reinicios y deploys.
 */
export const useSupabaseAuthState = async (supabase, tenantId) => {
  // 1) Buscar fila existente de sesión para ese tenant
  const { data: row, error: fetchError } = await supabase
    .from("whatsapp_sessions")
    .select("id, auth_state")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (fetchError) {
    console.error(
      "[Supabase Auth] Error buscando whatsapp_sessions:",
      fetchError
    );
  }

  let creds;
  let keys = {};

  if (row?.auth_state) {
    // 2) Si hay auth_state, lo reconstruimos usando BufferJSON.reviver
    try {
      const parsedState = JSON.parse(
        JSON.stringify(row.auth_state),
        BufferJSON.reviver
      );
      creds = parsedState.creds;
      keys = parsedState.keys || {};
      console.log(
        "[Supabase Auth]",
        `Auth state cargado desde DB para tenant ${tenantId}`
      );
    } catch (e) {
      console.error(
        "[Supabase Auth] Error parseando auth_state, re-inicializando credenciales:",
        e
      );
      creds = initAuthCreds();
      keys = {};
    }
  } else {
    // 3) Si no hay fila o está vacía, inicializamos credenciales nuevas
    console.log(
      "[Supabase Auth]",
      `No había auth_state para tenant ${tenantId}, creando nuevas credenciales`
    );
    creds = initAuthCreds();
    keys = {};

    // Asegurar que exista la fila para ese tenant (insert si no está)
    const { error: insertError } = await supabase
      .from("whatsapp_sessions")
      .insert([{ tenant_id: tenantId, status: "disconnected", auth_state: null }])
      .onConflict("tenant_id")
      .ignore();

    if (insertError) {
      console.error(
        "[Supabase Auth] Error creando fila inicial en whatsapp_sessions:",
        insertError
      );
    }
  }

  // 4) Función que guarda el estado completo (creds + keys) en Supabase
  const saveState = async () => {
    try {
      const stateToSave = JSON.parse(
        JSON.stringify({ creds, keys }, BufferJSON.replacer)
      );

      const { error: upsertError } = await supabase
        .from("whatsapp_sessions")
        .upsert(
          [
            {
              tenant_id: tenantId,
              auth_state: stateToSave,
            },
          ],
          { onConflict: "tenant_id" }
        );

      if (upsertError) {
        console.error(
          "[Supabase Auth] Error guardando auth_state en whatsapp_sessions:",
          upsertError
        );
      } else {
        // console.log("[Supabase Auth] Auth state guardado para", tenantId);
      }
    } catch (e) {
      console.error("[Supabase Auth] Error serializando auth_state:", e);
    }
  };

  return {
    state: {
      creds,
      keys: {
        /**
         * get(type, ids) -> devuelve las llaves pedidas para Baileys
         */
        get: (type, ids) => {
          const data = {};
          ids.forEach((id) => {
            let value = keys[type]?.[id];
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          });
          return data;
        },
        /**
         * set(data) -> Baileys nos pasa llaves nuevas/actualizadas
         */
        set: async (data) => {
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              if (!keys[category]) keys[category] = {};
              keys[category][id] = value;
            }
          }
          await saveState();
        },
      },
    },
    saveCreds: saveState,
  };
};
