"use client";

import { useState } from "react";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Mode = "login" | "register" | "reset";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // ✅ booleans derivados para evitar el error 2367
  const isLogin = mode === "login";
  const isRegister = mode === "register";
  const isReset = mode === "reset";

  const goDashboard = () => (window.location.href = "/dashboard");

  async function handleEmailPass(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setLoading(true);

    try {
      if (isLogin) {
        const { error } = await sb.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
        goDashboard();
      }

      if (isRegister) {
        const { data, error } = await sb.auth.signUp({
          email,
          password: pass,
          options: {
            emailRedirectTo:
              typeof window !== "undefined" ? `${window.location.origin}/dashboard` : undefined,
            data: { full_name: email.split("@")[0] },
          },
        });
        if (error) throw error;

        if (data.user && !data.session) {
          setMsg("Revisa tu correo para confirmar tu cuenta y luego inicia sesión.");
        } else {
          goDashboard();
        }
      }

      if (isReset) {
        const { error } = await sb.auth.resetPasswordForEmail(email, {
          redirectTo:
            typeof window !== "undefined" ? `${window.location.origin}/login` : undefined,
        });
        if (error) throw error;
        setMsg("Te enviamos un correo para restablecer tu contraseña.");
      }
    } catch (e: any) {
      const m = e?.message || "Ocurrió un error, intenta de nuevo.";
      if (m.includes("Invalid login credentials")) setErr("Credenciales inválidas.");
      else if (m.includes("User already registered")) setErr("Ese correo ya está registrado. Inicia sesión.");
      else setErr(m);
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setErr(null);
    setMsg(null);
    setLoading(true);
    try {
      const { error } = await sb.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo:
            typeof window !== "undefined" ? `${window.location.origin}/dashboard` : undefined,
        },
      });
      if (error) throw error;
    } catch (e: any) {
      setErr(e?.message || "No se pudo iniciar con Google.");
      setLoading(false);
    }
  }

  const title = isLogin ? "Inicia sesión" : isRegister ? "Crea tu cuenta" : "Restablecer contraseña";
  const cta = isLogin ? "Entrar" : isRegister ? "Registrarme" : "Enviar enlace";

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative">
      {/* Fondo suave */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute -top-32 -left-24 h-[420px] w-[420px] rounded-full blur-3xl opacity-50"
          style={{
            background:
              "radial-gradient(45% 45% at 50% 50%, #7c3aed30 0%, #6366f130 40%, transparent 70%)",
          }}
        />
        <div
          className="absolute -bottom-40 -right-24 h-[520px] w-[520px] rounded-full blur-3xl opacity-50"
          style={{
            background:
              "radial-gradient(45% 45% at 50% 50%, #06b6d430 0%, #6366f130 40%, transparent 70%)",
          }}
        />
      </div>

      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-white/60 bg-white/80 backdrop-blur-xl shadow-[0_12px_60px_rgba(2,6,23,.08)] p-8">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-2 h-12 w-12 rounded-2xl bg-indigo-600/10 flex items-center justify-center">
              <span className="text-indigo-600 font-bold text-xl">PB</span>
            </div>
            <h1 className="text-2xl font-semibold">{title}</h1>
            <p className="text-sm text-gray-500">PymeBOT • Acceso seguro</p>
          </div>

          <form className="space-y-4" onSubmit={handleEmailPass}>
            <div>
              <label className="text-sm font-medium text-gray-700">Correo</label>
              <input
                type="email"
                className="mt-1 w-full rounded-xl border px-3 py-2 outline-none bg-gray-50 focus:ring-4 focus:ring-indigo-100"
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            {!isReset && (
              <div>
                <label className="text-sm font-medium text-gray-700">Contraseña</label>
                <input
                  type="password"
                  className="mt-1 w-full rounded-xl border px-3 py-2 outline-none bg-gray-50 focus:ring-4 focus:ring-indigo-100"
                  placeholder="••••••••"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  required={!isReset}
                  autoComplete={(isLogin ? "current-password" : "new-password") as
                    | "current-password"
                    | "new-password"}
                />
              </div>
            )}

            {err && <div className="text-sm text-red-600">{err}</div>}
            {msg && <div className="text-sm text-emerald-600">{msg}</div>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-indigo-600 text-white py-2.5 font-medium hover:bg-indigo-700 disabled:opacity-60 transition"
            >
              {loading ? (isLogin ? "Entrando..." : isRegister ? "Creando..." : "Enviando...") : cta}
            </button>
          </form>

          <div className="my-4 flex items-center gap-4">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-xs text-gray-400">o</span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

          <button
            onClick={handleGoogle}
            className="w-full rounded-xl border py-2.5 font-medium hover:bg-gray-50 transition"
          >
            Continuar con Google
          </button>

          <div className="mt-4 flex items-center justify-between text-xs">
            {isLogin ? (
              <>
                <button className="text-gray-500 hover:text-indigo-600" onClick={() => setMode("register")}>
                  ¿No tienes cuenta? Regístrate
                </button>
                <button className="text-gray-500 hover:text-indigo-600" onClick={() => setMode("reset")}>
                  Olvidé mi contraseña
                </button>
              </>
            ) : isRegister ? (
              <>
                <button className="text-gray-500 hover:text-indigo-600" onClick={() => setMode("login")}>
                  ¿Ya tienes cuenta? Inicia sesión
                </button>
                <button className="text-gray-500 hover:text-indigo-600" onClick={() => setMode("reset")}>
                  Olvidé mi contraseña
                </button>
              </>
            ) : (
              <button className="text-gray-500 hover:text-indigo-600" onClick={() => setMode("login")}>
                Volver a iniciar sesión
              </button>
            )}
          </div>

          <p className="mt-4 text-center text-[11px] text-gray-400">
            Al continuar aceptas los <b>Términos</b> y la <b>Política de Privacidad</b>.
          </p>
        </div>
      </div>
    </div>
  );
}
