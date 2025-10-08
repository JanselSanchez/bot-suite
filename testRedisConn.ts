// testRedisConn.ts
import 'dotenv/config';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import IORedis from 'ioredis';

const url = process.env.REDIS_URL!;
if (!url) {
  console.error('❌ Falta REDIS_URL en .env.local');
  process.exit(1);
}

const useTls = url.startsWith('rediss://');
console.log('URL:', url, '| TLS:', useTls ? 'ON' : 'OFF');

const r = new IORedis(url, {
  tls: useTls ? {} : undefined,
  family: 4,                // fuerza IPv4 cuando aplique
  connectTimeout: 20000,
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  retryStrategy(times) {
    return Math.min(1000 * Math.pow(2, times), 10000);
  },
});

r.on('error', (e) => console.error('[ioredis error]', e.message));
r.on('connect', () => console.log('🔌 Conectando a Redis...'));
r.on('ready', () => console.log('✅ Redis listo'));

r.ping()
  .then((x) => {
    console.log('PING ->', x); // PONG esperado
    return r.disconnect();
  })
  .catch((err) => {
    console.error('Conn error:', err);
    r.disconnect();
  });
