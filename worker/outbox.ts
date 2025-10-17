import { pool } from '@/app/lib/db'
import { sendWhatsApp } from '@/app/lib/whatsapp'
import { Worker } from 'bullmq'
import IORedis from 'ioredis'

const connection = new IORedis(process.env.REDIS_URL!)
const MAX = Number(process.env.MAX_ATTEMPTS ?? 6)

new Worker('outbox', async () => {
  const { rows } = await pool.query(`
    SELECT id, payload, attempts FROM public.outbox
    WHERE status IN ('pending','queued') ORDER BY created_at ASC LIMIT 20
  `)
  for (const r of rows) {
    const to = r.payload?.to, body = r.payload?.body
    try {
      await sendWhatsApp(to, body)
      await pool.query(`UPDATE public.outbox SET status='sent', updated_at=now() WHERE id=$1`, [r.id])
    } catch (err) {
      const attempts = Number(r.attempts) + 1
      const status = attempts >= MAX ? 'failed' : 'pending'
      await pool.query(`
        UPDATE public.outbox
           SET attempts=$2, status=$3, last_error=$4, updated_at=now()
         WHERE id=$1
      `, [r.id, attempts, String(err), status])
      if (status === 'failed') {
        await reportError({
          source: 'worker:outbox', severity: 'critical', code: 'OUTBOX_FAILED_MAX',
          err, context: { outbox_id: r.id, attempts }
        })
      }
    }
  }
}, { connection })
