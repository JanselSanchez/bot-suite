// src/app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import AuthListener from "./AuthListener";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "PymeBOT • Dashboard",
  description: "Administra citas, disponibilidad y clientes",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="h-full">
      <body className={`${inter.className} h-full text-gray-900 antialiased`}>
        <AuthListener/>
        {/* Quita el container que des-centra */}
        <main className="w-full">{children}</main>
      </body>
    </html>
  );
}

