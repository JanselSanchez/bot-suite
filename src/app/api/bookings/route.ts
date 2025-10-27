import { pool } from '@/app/lib/db'
import { NextResponse } from 'next/server'

/**
 * GET /api/bookings?tenant=<uuid>&status=<str>&service_id=<uuid>&resource_id=<uuid>
 *   &from=<ISO>&to=<ISO>&phone=<str>&page=1&pageSize=20
 *
 * Devuelve: { data: [], page, pageSize, total, hasMore }
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)

    const tenant     = url.searchParams.get('tenant')      // opcional si lo infieres por JWT/RLS
    const status     = url.searchParams.get('status')      // confirmed|cancelled|no_show|...
    const serviceId  = url.searchParams.get('service_id')
    const resourceId = url.searchParams.get('resource_id')
    const fromStr    = url.searchParams.get('from')        // ISO
    const toStr      = url.searchParams.get('to')          // ISO
    const phone      = url.searchParams.get('phone')       // búsqueda exacta o parcial

    const page       = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
    const pageSize   = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '20', 10)))
    const offset     = (page - 1) * pageSize

    const where: string[] = []
    const params: any[] = []
    let i = 1

    if (tenant) { where.push(`b.tenant_id = $${i++}`); params.push(tenant) }
    if (status) { where.push(`b.status::text = $${i++}`); params.push(status) }
    if (serviceId) { where.push(`b.service_id = $${i++}`); params.push(serviceId) }
    if (resourceId) { where.push(`b.resource_id = $${i++}`); params.push(resourceId) }
    if (fromStr) { where.push(`b.starts_at >= $${i++}`); params.push(new Date(fromStr)) }
    if (toStr)   { where.push(`b.starts_at <  $${i++}`); params.push(new Date(toStr)) }
    if (phone)   { where.push(`b.customer_phone ILIKE $${i++}`); params.push(`%${phone}%`) }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    // total
    const countSql = `
      SELECT count(*)::int AS total
      FROM public.bookings b
      ${whereSql}
    `
    const { rows: countRows } = await pool.query(countSql, params)
    const total = countRows[0]?.total ?? 0

    // page
    const dataSql = `
      SELECT
        b.id, b.tenant_id, b.service_id, b.resource_id,
        b.starts_at, b.ends_at, b.status::text AS status,
        b.customer_phone,
        b.created_at
      FROM public.bookings b
      ${whereSql}
      ORDER BY b.starts_at DESC
      LIMIT $${i++} OFFSET $${i++}
    `
    const { rows } = await pool.query(dataSql, [...params, pageSize, offset])

    return NextResponse.json({
      data: rows,
      page,
      pageSize,
      total,
      hasMore: offset + rows.length < total
    })
  } catch (e: any) {
    return new NextResponse('Error listando bookings: ' + e.message, { status: 500 })
  }
}
