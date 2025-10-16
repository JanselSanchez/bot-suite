import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query as { id: string };
  const { data, error } = await sb
    .from("bookings")
    .select("id, tenant_id, service_id, starts_at, resource_id")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) {
    return res.status(404).json({ ok: false, error: "Booking no encontrada" });
  }
  res.json({ ok: true, data });
}
