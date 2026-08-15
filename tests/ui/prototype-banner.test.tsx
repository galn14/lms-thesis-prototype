import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { PrototypeBanner } from '@/components/common/prototype-banner';

describe('PrototypeBanner', () => {
  const originalPublicMode = process.env.NEXT_PUBLIC_PROTOTYPE_MODE;

  afterEach(() => {
    if (originalPublicMode === undefined) {
      delete process.env.NEXT_PUBLIC_PROTOTYPE_MODE;
    } else {
      process.env.NEXT_PUBLIC_PROTOTYPE_MODE = originalPublicMode;
    }
  });

  it('shows the synthetic-data warning in public prototype mode', () => {
    process.env.NEXT_PUBLIC_PROTOTYPE_MODE = 'true';

    expect(renderToStaticMarkup(createElement(PrototypeBanner))).toContain(
      'Mode Prototype — hasil berasal dari data sintetis'
    );
  });

  it('renders nothing outside public prototype mode', () => {
    process.env.NEXT_PUBLIC_PROTOTYPE_MODE = 'false';

    expect(renderToStaticMarkup(createElement(PrototypeBanner))).toBe('');
  });
});
