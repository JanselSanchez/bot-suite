//superbase.ts
// usa el service role (server only)
import { createClient } from "@supabase/supabase-js";

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,  // NO usar en el cliente
  { auth: { persistSession: false } }
);
