import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

const { withSentryConfig } = require('@sentry/nextjs');

module.exports = withSentryConfig(nextConfig, {
  // Opcional: controla subida de sourcemaps y minificación
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: true, // menos ruido en build
}, {
  // Opcional: runtime config
});

export default nextConfig;
