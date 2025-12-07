"use server";

import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

// Helper de conexión (Blindado)
function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Faltan credenciales Supabase");
  return createClient(url, key);
}

// 1. LEER PERFIL (Para mostrarlo en el formulario)
export async function getProfile(tenantId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("business_profiles")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  
  // Si no existe, devolvemos null o valores por defecto
  return data || {
    bot_name: "",
    bot_tone: "Amable y profesional",
    business_type: "general",
    address: "",
    custom_instructions: ""
  };
}

// 2. GUARDAR / ACTUALIZAR PERFIL
export async function saveProfile(formData: FormData) {
  const supabase = getSupabase();
  
  const tenantId = formData.get("tenantId") as string;
  
  const profileData = {
    tenant_id: tenantId,
    bot_name: formData.get("bot_name"),
    bot_tone: formData.get("bot_tone"),
    business_type: formData.get("business_type"),
    address: formData.get("address"),
    custom_instructions: formData.get("custom_instructions"),
    // Convertimos métodos de pago a Array (si vienen separados por coma)
    // payment_methods: formData.get("payment_methods")?.toString().split(",") || []
  };

  const { error } = await supabase
    .from("business_profiles")
    .upsert(profileData, { onConflict: "tenant_id" });

  if (error) return { error: error.message };

  revalidatePath("/dashboard/settings"); // O la ruta donde pongas esto
  return { success: true };
}