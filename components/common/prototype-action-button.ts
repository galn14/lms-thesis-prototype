import {
  createElement,
  type ButtonHTMLAttributes,
  type ReactElement,
} from 'react';
import { isPublicPrototypeMode } from '@/lib/public-prototype-mode';

export type PrototypeAction =
  | 'grading'
  | 'plagiarism'
  | 'credential'
  | 'resource-upload'
  | 'resource-delete';

const DISABLED_TITLES: Record<PrototypeAction, string> = {
  grading: 'New grading runs are disabled in prototype mode',
  plagiarism: 'New plagiarism checks are disabled in prototype mode',
  credential: 'Provider credential changes are disabled in prototype mode',
  'resource-upload': 'File uploads are disabled in prototype mode',
  'resource-delete': 'File deletion is disabled in prototype mode',
};

export function prototypeActionState(
  action: PrototypeAction,
  disabled: boolean
): { disabled: boolean; title: string | undefined } {
  if (!isPublicPrototypeMode()) {
    return { disabled, title: undefined };
  }

  return { disabled: true, title: DISABLED_TITLES[action] };
}

interface PrototypeActionButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  prototypeAction: PrototypeAction;
}

export function PrototypeActionButton({
  prototypeAction,
  disabled = false,
  title,
  children,
  ...props
}: PrototypeActionButtonProps): ReactElement {
  const state = prototypeActionState(prototypeAction, disabled);

  return createElement(
    'button',
    {
      ...props,
      disabled: state.disabled,
      title: state.title ?? title,
      'data-prototype-action': prototypeAction,
    },
    children
  );
}
