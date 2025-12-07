"use server";

import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

// --- HELPER INTERNO PARA CONECTAR ---
function getSupabase() {
  // Usamos las mismas variables que ya tienes en tu .env
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!; // Usamos la Service Key para tener permisos de escritura (Admin)

  if (!url || !key) {
    throw new Error("Faltan credenciales de Supabase en .env");
  }

  return createClient(url, key);
}

// --- ACCIONES ---

export async function getItems(tenantId: string) {
  const supabase = getSupabase();
  
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
}

export async function createItem(formData: FormData) {
  const supabase = getSupabase();
  
  const tenantId = formData.get("tenantId") as string;
  const name = formData.get("name") as string;
  const description = formData.get("description") as string;
  const price = Number(formData.get("price")); 
  const type = formData.get("type") as "service" | "product";
  const duration = Number(formData.get("duration") || 0);
  const category = formData.get("category") as string;

  if (!name || !price || !tenantId) {
    return { error: "Faltan datos obligatorios" };
  }

  // Guardamos precio en centavos (ej: 100 -> 10000)
  const priceCents = Math.round(price * 100);

  const { error } = await supabase.from("items").insert({
    tenant_id: tenantId,
    name,
    description,
    price_cents: priceCents,
    type,
    duration_minutes: type === "service" ? duration : 0,
    category,
    is_active: true
  });

  if (error) return { error: error.message };

  revalidatePath("/dashboard/catalog"); 
  return { success: true };
}

export async function deleteItem(itemId: string) {
  const supabase = getSupabase();
  const { error } = await supabase.from("items").delete().eq("id", itemId);
  
  if (error) return { error: error.message };
  
  revalidatePath("/dashboard/catalog");
  return { success: true };
}