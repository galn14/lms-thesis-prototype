import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { checkDatabaseHealth } from '@/lib/db-utils';

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const health = await checkDatabaseHealth();

    if (health.connected) {
      return NextResponse.json({ status: 'success' }, { status: 200 });
    }

    return NextResponse.json(
      { status: 'error', message: 'Database unavailable' },
      { status: 503 }
    );
  } catch {
    console.error('Database health check failed');
    return NextResponse.json(
      { status: 'error', message: 'Internal server error' },
      { status: 500 }
    );
  }
}
