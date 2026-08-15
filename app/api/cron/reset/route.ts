import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import {
  resetPrototypeDatabase,
  ResetInProgressError,
} from '@/lib/prototype/reset';

export const dynamic = 'force-dynamic';

function fixedLengthDigest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function isAuthorized(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return false;
  const provided = authorization.slice('Bearer '.length);
  return timingSafeEqual(fixedLengthDigest(provided), fixedLengthDigest(secret));
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request, process.env.CRON_SECRET)) {
    return NextResponse.json(
      { success: false, code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  try {
    const result = await resetPrototypeDatabase();
    return NextResponse.json({ success: true, ...result }, { status: 200 });
  } catch (error) {
    if (error instanceof ResetInProgressError) {
      return NextResponse.json(
        { success: false, code: 'RESET_IN_PROGRESS' },
        { status: 409 }
      );
    }
    console.error('Prototype reset failed');
    return NextResponse.json(
      { success: false, code: 'RESET_FAILED' },
      { status: 500 }
    );
  }
}
