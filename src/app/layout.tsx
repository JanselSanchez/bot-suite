// src/app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "PymeBOT • Dashboard",
  description: "Administra citas, disponibilidad y clientes",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="h-full">
      <body className={`${inter.className} h-full bg-gray-50 text-gray-900 antialiased`}>
        <div className="min-h-full">
          <header className="border-b bg-white">
            <div className="container">
              <div className="flex items-center justify-between py-4">
                <h1 className="text-xl font-semibold tracking-tight">PymeBOT</h1>
                <nav className="flex gap-4 text-sm text-gray-600">
                  <a className="hover:text-gray-900" href="/dashboard/bookings">Citas</a>
                  <a className="hover:text-gray-900" href="/ui-test/reschedule">Reprogramar</a>
                </nav>
              </div>
            </div>
          </header>
          <main className="container py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
