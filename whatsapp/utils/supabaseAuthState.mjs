// whatsapp/utils/wa-server/supabaseAuthState.mjs
import { initAuthCreds, BufferJSON, proto } from "@whiskeysockets/baileys";

export const useSupabaseAuthState = async (supabase, tenantId) => {
  // 1. Cargar datos iniciales
  const { data: row, error } = await supabase
    .from("whatsapp_sessions")
    .select("auth_state")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  let creds;
  let keys = {};

  // Recuperar sesión o iniciar nueva
  if (row?.auth_state) {
    try {
      const parsed = JSON.parse(JSON.stringify(row.auth_state), BufferJSON.reviver);
      creds = parsed.creds;
      keys = parsed.keys || {};
    } catch (e) {
      console.error("Error parseando sesión, reiniciando:", e);
      creds = initAuthCreds();
    }
  } else {
    creds = initAuthCreds();
  }

  // 2. Lógica de guardado con DEBOUNCE (La solución mágica)
  // Evita que saturemos la DB y corrompamos los datos por escrituras simultáneas
  let saveTimeout = null;

  const saveState = async () => {
    // Si ya hay un guardado pendiente, lo cancelamos y esperamos más
    if (saveTimeout) clearTimeout(saveTimeout);

    saveTimeout = setTimeout(async () => {
      try {
        // Serializamos
        const stateToSave = JSON.parse(
          JSON.stringify({ creds, keys }, BufferJSON.replacer)
        );

        // Guardamos en DB
        const { error } = await supabase
          .from("whatsapp_sessions")
          .upsert(
            [{ tenant_id: tenantId, auth_state: stateToSave }],
            { onConflict: "tenant_id" }
          );

        if (error) console.error("Error guardando AuthState:", error.message);
      } catch (e) {
        console.error("Error serializando AuthState:", e);
      }
    }, 2000); // Espera 2 segundos de inactividad antes de guardar
  };

  return {
    state: {
      creds,
      keys: {
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
        set: (data) => {
          for (const category in data) {
            keys[category] = keys[category] || {};
            for (const id in data[category]) {
              keys[category][id] = data[category][id];
            }
          }
          // Llamamos al guardado (que ahora espera 2s)
          saveState();
        },
      },
    },
    saveCreds: saveState,
  };
};