import * as Sentry from '@sentry/node';
// Si usas ESM: import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  enabled: !!process.env.SENTRY_DSN,
});

export { Sentry };
