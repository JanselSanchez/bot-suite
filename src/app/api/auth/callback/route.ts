import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function POST(req: Request) {
  const { event, session } = await req.json();
  const cookieStore = await cookies();
  const res = NextResponse.json({ ok: true });

  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll().map(({ name, value }) => ({ name, value }));
        },
        setAll(cookies) {
          for (const { name, value, options } of cookies) {
            res.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
    await sb.auth.setSession(session);
  }
  if (event === "SIGNED_OUT") {
    await sb.auth.signOut();
  }

  return res;
}
