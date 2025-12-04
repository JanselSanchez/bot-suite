// whatsapp/utils/supabaseAuthState.mjs
import { initAuthCreds, BufferJSON, proto } from "@whiskeysockets/baileys";

/**
 * Guarda el auth_state de Baileys en la tabla `whatsapp_sessions`
 * usando tenant_id como clave.
 *
 * Tabla esperada:
 *  - tenant_id (uuid, PK o UNIQUE)
 *  - auth_state (jsonb, nullable)
 */
export async function useSupabaseAuthState(supabase, tenantId) {
  // 1. Buscar si ya existen datos guardados para este tenant
  const { data, error } = await supabase
    .from("whatsapp_sessions")
    .select("auth_state")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    console.error("[Supabase Auth] Error cargando sesión:", error);
  }

  let creds;
  let keys = {};

  // 2. Si hay datos, los recuperamos y decodificamos
  if (data?.auth_state) {
    try {
      const parsedState = JSON.parse(
        JSON.stringify(data.auth_state),
        BufferJSON.reviver
      );

      if (parsedState.creds) {
        creds = proto.Credentials.fromObject(parsedState.creds);
      } else {
        creds = initAuthCreds();
      }

      keys = parsedState.keys || {};
    } catch (e) {
      console.error("[Supabase Auth] Error parseando auth_state:", e);
      creds = initAuthCreds();
      keys = {};
    }
  } else {
    // 3. Si no hay datos, inicializamos credenciales nuevas
    creds = initAuthCreds();
  }

  // 4. Función para guardar (se ejecuta cada vez que Baileys actualiza llaves/creds)
  const saveState = async () => {
    try {
      const stateToSave = JSON.parse(
        JSON.stringify({ creds, keys }, BufferJSON.replacer)
      );

      const { error: saveError } = await supabase
        .from("whatsapp_sessions")
        .upsert(
          {
            tenant_id: tenantId,
            auth_state: stateToSave,
          },
          { onConflict: "tenant_id" }
        );

      if (saveError) {
        console.error("[Supabase Auth] Error guardando sesión:", saveError);
      }
    } catch (e) {
      console.error("[Supabase Auth] Excepción guardando sesión:", e);
    }
  };

  const state = {
    creds,
    keys: {
      get: (type, ids) => {
        const result = {};
        for (const id of ids) {
          let value = keys[type]?.[id];

          if (type === "app-state-sync-key" && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value);
          }

          result[id] = value || null;
        }
        return result;
      },
      set: async (data) => {
        for (const category of Object.keys(data)) {
          if (!keys[category]) keys[category] = {};
          for (const id of Object.keys(data[category])) {
            keys[category][id] = data[category][id];
          }
        }
        await saveState();
      },
    },
  };

  return {
    state,
    saveCreds: saveState,
  };
}
