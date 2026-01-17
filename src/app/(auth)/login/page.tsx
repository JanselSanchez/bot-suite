"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

type Mode = "login" | "register" | "reset";

export default function LoginPage() {
  const supabase = createClientComponentClient();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const isLogin = mode === "login";
  const isRegister = mode === "register";
  const isReset = mode === "reset";

  const goDashboard = () => router.replace("/dashboard");

  async function handleEmailPass(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setLoading(true);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password: pass,
        });
        if (error) throw error;

        // importante cuando hay server components/middleware
        router.refresh();
        goDashboard();
        return;
      }

      if (isRegister) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password: pass,
          options: {
            data: { full_name: email.split("@")[0] },
          },
        });
        if (error) throw error;

        if (data.user && !data.session) {
          setMsg("Revisa tu correo para confirmar tu cuenta y luego inicia sesión.");
        } else {
          router.refresh();
          goDashboard();
        }
        return;
      }

      if (isReset) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/login`,
        });
        if (error) throw error;
        setMsg("Te enviamos un correo para restablecer tu contraseña.");
        return;
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
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          // OJO: mejor manda a un callback y desde ahí rediriges
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
    } catch (e: any) {
      setErr(e?.message || "No se pudo iniciar con Google.");
      setLoading(false);
    }
  }

  // 👇 MUY IMPORTANTE: estos botones dentro del form / UI deben ser type="button"
  // para que NO hagan submit accidental cuando cambias modo.
  // (abajo te marco cuáles)

  const title = isLogin ? "Inicia sesión" : isRegister ? "Crea tu cuenta" : "Restablecer contraseña";
  const cta = isLogin ? "Entrar" : isRegister ? "Registrarme" : "Enviar enlace";

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative">
      {/* ...tu UI igual... */}

      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-white/60 bg-white/80 backdrop-blur-xl shadow-[0_12px_60px_rgba(2,6,23,.08)] p-8">
          {/* ... */}

          <form className="space-y-4" onSubmit={handleEmailPass}>
            {/* ...inputs... */}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-indigo-600 text-white py-2.5 font-medium hover:bg-indigo-700 disabled:opacity-60 transition"
            >
              {loading ? (isLogin ? "Entrando..." : isRegister ? "Creando..." : "Enviando...") : cta}
            </button>
          </form>

          {/* ... */}

          <div className="mt-4 flex items-center justify-between text-xs">
            {isLogin ? (
              <>
                <button
                  type="button"
                  className="text-gray-500 hover:text-indigo-600"
                  onClick={() => setMode("register")}
                >
                  ¿No tienes cuenta? Regístrate
                </button>
                <button
                  type="button"
                  className="text-gray-500 hover:text-indigo-600"
                  onClick={() => setMode("reset")}
                >
                  Olvidé mi contraseña
                </button>
              </>
            ) : isRegister ? (
              <>
                <button
                  type="button"
                  className="text-gray-500 hover:text-indigo-600"
                  onClick={() => setMode("login")}
                >
                  ¿Ya tienes cuenta? Inicia sesión
                </button>
                <button
                  type="button"
                  className="text-gray-500 hover:text-indigo-600"
                  onClick={() => setMode("reset")}
                >
                  Olvidé mi contraseña
                </button>
              </>
            ) : (
              <button
                type="button"
                className="text-gray-500 hover:text-indigo-600"
                onClick={() => setMode("login")}
              >
                Volver a iniciar sesión
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
