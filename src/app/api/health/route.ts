// app/api/health/route.ts
import { NextResponse } from 'next/server'
import { Queue } from 'bullmq'
import IORedis from 'ioredis'

export async function GET() {
  try {
    const redis = new IORedis(process.env.REDIS_URL!)
    const bot = new Queue('bot', { connection: redis })
    const notifications = new Queue('notifications', { connection: redis })
    const outbox = new Queue('outbox', { connection: redis })
    const reminders = new Queue('reminders', { connection: redis })
    const noshow = new Queue('noshow', { connection: redis })

    const [r1, r2, r3, r4, r5] = await Promise.all([
      bot.getJobCounts(),
      notifications.getJobCounts(),
      outbox.getJobCounts(),
      reminders.getJobCounts(),
      noshow.getJobCounts(),
    ])

    return NextResponse.json({
      bot: 'up',
      notifications: 'up',
      outbox: 'up',
      reminders: 'up',
      noshow: 'up',
      queues: { bot: r1, notifications: r2, outbox: r3, reminders: r4, noshow: r5 },
      version: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local'
    })
  } catch (e) {
    return NextResponse.json({ status: 'down', error: (e as Error).message }, { status: 500 })
  }
}
