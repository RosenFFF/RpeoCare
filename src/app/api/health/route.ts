import { NextResponse } from 'next/server';
import { db } from '@/server/audit/store';
import { poolOnline } from '@/server/audit/queue';

export const dynamic = 'force-dynamic';
export async function GET() {
  try { db().prepare('SELECT 1').get(); const worker = poolOnline(); return NextResponse.json({ status: worker ? 'ok' : 'degraded', database: true, worker }, { status: worker ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }); }
  catch { return NextResponse.json({ status: 'unavailable', database: false }, { status: 503 }); }
}
