import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PrototypeActionButton,
  prototypeActionState,
  type PrototypeAction,
} from '@/components/common/prototype-action-button';

describe('prototype action controls', () => {
  const originalPublicMode = process.env.NEXT_PUBLIC_PROTOTYPE_MODE;
  const actions: PrototypeAction[] = [
    'grading',
    'plagiarism',
    'credential',
    'resource-upload',
    'resource-delete',
  ];

  afterEach(() => {
    if (originalPublicMode === undefined) {
      delete process.env.NEXT_PUBLIC_PROTOTYPE_MODE;
    } else {
      process.env.NEXT_PUBLIC_PROTOTYPE_MODE = originalPublicMode;
    }
  });

  it.each(actions)('disables the %s control with an explanatory title', action => {
    process.env.NEXT_PUBLIC_PROTOTYPE_MODE = 'true';

    const state = prototypeActionState(action, false);
    const html = renderToStaticMarkup(
      createElement(
        PrototypeActionButton,
        { prototypeAction: action, disabled: false },
        'Action'
      )
    );

    expect(state.disabled).toBe(true);
    expect(state.title).toContain('prototype mode');
    expect(html).toContain('disabled=""');
    expect(html).toContain(`data-prototype-action="${action}"`);
    expect(html).toContain('title=');
  });

  it('preserves the original disabled state outside prototype mode', () => {
    process.env.NEXT_PUBLIC_PROTOTYPE_MODE = 'false';

    expect(prototypeActionState('grading', false)).toEqual({
      disabled: false,
      title: undefined,
    });
    expect(prototypeActionState('grading', true)).toEqual({
      disabled: true,
      title: undefined,
    });
  });

  it('renders an enabled control with its caller title outside prototype mode', () => {
    process.env.NEXT_PUBLIC_PROTOTYPE_MODE = 'false';

    const html = renderToStaticMarkup(
      createElement(
        PrototypeActionButton,
        { prototypeAction: 'resource-upload', title: 'Attach a file' },
        'Attach'
      )
    );

    expect(html).not.toContain('disabled=""');
    expect(html).toContain('title="Attach a file"');
    expect(html).toContain('data-prototype-action="resource-upload"');
  });
});
