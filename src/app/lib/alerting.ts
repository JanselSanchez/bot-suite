type Severity = 'info'|'warn'|'error'|'critical';

const ORDER: Severity[] = ['info','warn','error','critical'];
const cache = new Map<string, number>(); // anti-spam por código/source

export async function reportError(db: any, args: {
  tenantId?: string | null;
  source: string;                  // 'api', 'worker:notifications', ...
  severity?: Severity;
  code?: string;
  err?: unknown;
  msg?: string;
  context?: Record<string, unknown>;
}) {
  const { sendWhatsApp } = await import('./whatsapp');
  const sev: Severity = args.severity ?? 'error';
  const message = args.msg ?? (args.err instanceof Error ? args.err.message : String(args.err ?? ''));
  const stack   = args.err instanceof Error ? args.err.stack : null;

  // 1) Persistir en DB
  await db`
    INSERT INTO public.error_events(tenant_id, source, severity, code, message, stack, context)
    VALUES (${args.tenantId ?? null}, ${args.source}, ${sev}, ${args.code ?? null}, ${message}, ${stack}, ${args.context ?? null})
  `;

  // 2) Anti-spam por (source+code) durante ALERTS_SILENCE_MINUTES
  const min = (process.env.ALERTS_MIN_SEVERITY ?? 'error') as Severity;
  if (ORDER.indexOf(sev) < ORDER.indexOf(min)) return;

  const silence = Math.max(1, parseInt(process.env.ALERTS_SILENCE_MINUTES ?? '10', 10));
  const key = `${args.source}:${args.code ?? 'no_code'}`;
  const now = Date.now();
  const last = cache.get(key) ?? 0;
  if (now - last < silence * 60_000) return; // silenciado
  cache.set(key, now);

  // 3) Enviar alerta por WhatsApp a los admins
  const toList = (process.env.ADMIN_ALERTS_WHATSAPP ?? '')
    .split(',').map(s=>s.trim()).filter(Boolean);

  if (toList.length) {
    const lines = [
      `🚨 *${sev.toUpperCase()}* · ${args.source}`,
      args.code ? `Código: ${args.code}` : null,
      `Msg: ${message.slice(0, 350)}`,
      args.context?.booking_id ? `Booking: ${args.context.booking_id}` : null,
      args.context?.job_id ? `Job: ${args.context.job_id}` : null,
      `⏱️ ${new Date().toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' })}`
    ].filter(Boolean);
    const text = lines.join('\n');
    await Promise.all(toList.map(to => sendWhatsApp(to, text).catch(()=>{})));
  }
}
