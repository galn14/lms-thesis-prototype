import { NextResponse } from 'next/server';

export const PROTOTYPE_EXTERNAL_PROCESSING_DISABLED =
  'PROTOTYPE_EXTERNAL_PROCESSING_DISABLED' as const;

export function isPrototypeMode(): boolean {
  return process.env.PROTOTYPE_MODE === 'true';
}

export function prototypeExternalProcessingResponse(): NextResponse | null {
  if (!isPrototypeMode()) return null;

  return NextResponse.json(
    {
      success: false,
      code: PROTOTYPE_EXTERNAL_PROCESSING_DISABLED,
      error: 'External processing is disabled in this prototype',
    },
    { status: 503 }
  );
}
