import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PymeBOT",
  description: "Plataforma de bots para negocios",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="text-slate-900 antialiased min-h-screen">
        {/* ===== FONDO GLOBAL (centrado y fijo) ===== */}
        <div className="pointer-events-none fixed inset-0 -z-50">
          {/* Radiales suaves */}
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
          {/* Grid centrado (dos capas para efecto “offset”) */}
          <div
            className="absolute inset-0 opacity-[0.12]"
            style={{
              backgroundImage:
                "radial-gradient(#1e293b 1px, transparent 1px), radial-gradient(#1e293b 1px, transparent 1px)",
              backgroundSize: "24px 24px, 24px 24px",
              backgroundPosition: "50% 50%, calc(50% + 12px) calc(50% + 12px)", // ← centrado real
            }}
          />
          {/* Noise leve */}
          <div
            className="absolute inset-0 opacity-[0.06] mix-blend-multiply"
            style={{
              backgroundImage:
                "url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2248%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%222%22 stitchTiles=%22stitch%22/></filter><rect width=%2248%22 height=%2248%22 filter=%22url(%23n)%22 opacity=%220.15%22/></svg>')",
            }}
          />
        </div>

        {children}
      </body>
    </html>
  );
}
