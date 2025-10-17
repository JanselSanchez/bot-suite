// app/api/sentry-test/route.ts
import { NextResponse } from 'next/server';
export const revalidate = 0;

export async function GET() {
  throw new Error('SENTRY_TEST: API fallida');
  // return NextResponse.json({ ok: true });
}
