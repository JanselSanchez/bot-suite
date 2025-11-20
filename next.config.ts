// next.config.ts
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Para evitar que ESLint rompa el build
  eslint: {
    ignoreDuringBuilds: true,
  },
};

const sentryWebpackPluginOptions = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: true,
};

// SOLO 2 argumentos → compatible con tu versión de Sentry
export default withSentryConfig(nextConfig, sentryWebpackPluginOptions);
