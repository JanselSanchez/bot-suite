// jobs/watchdog.ts
import { Queue } from 'bullmq'
import IORedis from 'ioredis'

const redis = new IORedis(process.env.REDIS_URL!)

const QUEUES = ['bot', 'notifications', 'outbox', 'reminders', 'noshow'] as const
const MAX_DELAYED = Number(process.env.WATCHDOG_MAX_DELAYED ?? 100)
const MAX_ACTIVE  = Number(process.env.WATCHDOG_MAX_ACTIVE  ?? 50)

async function checkQueue(name: string) {
  const q = new Queue(name, { connection: redis })
  // Métricas soportadas por BullMQ v4
  const counts = await q.getJobCounts('waiting','active','delayed','failed','completed','paused')

  // Señales de presión/atasco (ajusta umbrales a tu gusto)
  const pressure =
    counts.active  > MAX_ACTIVE  ||
    counts.delayed > MAX_DELAYED

  if (pressure) {
    await reportError({
      source: `watchdog:${name}`,
      severity: 'critical',
      code: 'QUEUE_PRESSURE',
      msg: `active=${counts.active}, delayed=${counts.delayed}, failed=${counts.failed}`
    })
  }

  await q.close()
}

async function main() {
  await Promise.all(QUEUES.map(checkQueue))
}

// Ejecuta y maneja errores correctamente (sin .finally sobre void)
main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    await reportError({
      source: 'watchdog',
      severity: 'critical',
      code: 'WATCHDOG_CRASH',
      err
    })
    process.exit(1)
  })
