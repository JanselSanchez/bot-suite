import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(req: NextRequest) {
  // Deriva IP desde headers (edge-friendly)
  const xff = req.headers.get('x-forwarded-for') ?? ''
  const ip = xff.split(',')[0]?.trim() || req.headers.get('x-real-ip') || ''
  const res = NextResponse.next()
  if (ip) res.headers.set('x-client-ip', ip) // si te sirve en tu backend
  return res
}
export const config = { matcher: ['/api/public/:path*'] }
