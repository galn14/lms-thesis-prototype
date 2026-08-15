import { createElement, type ReactElement } from 'react';
import { isPublicPrototypeMode } from '@/lib/public-prototype-mode';

export function PrototypeBanner(): ReactElement | null {
  if (!isPublicPrototypeMode()) return null;

  return createElement(
    'aside',
    {
      role: 'status',
      className:
        'w-full border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-sm font-semibold text-amber-950',
    },
    'Mode Prototype — hasil berasal dari data sintetis'
  );
}
