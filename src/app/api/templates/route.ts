import { pool } from '@/app/lib/db'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const tenant = url.searchParams.get('tenant') // opcional
    const params: any[] = []
    let where = ''

    if (tenant) {
      where = 'WHERE tenant_id = $1'
      params.push(tenant)
    }

    const { rows } = await pool.query(
      `
      SELECT id, tenant_id, channel, event, title, body, active, created_at
      FROM public.message_templates
      ${where}
      ORDER BY event
      `,
      params
    )

    return NextResponse.json(rows)
  } catch (e: any) {
    // Log mínimo (si quieres, llama reportError aquí)
    return new NextResponse('Error listando plantillas: ' + e.message, { status: 500 })
  }
}
