'use client';

import { useRef, useState } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { isRedirect, NETWORK_ERROR } from '@/components/action-form';
import { useToast } from '@/components/toast';
import type { ActionResult } from '@/lib/types';

type Props = Omit<ButtonProps, 'onClick'> & {
  /** A server action already bound to its arguments, for example `deleteIdea.bind(null, id)`. */
  action: () => Promise<ActionResult<unknown> | undefined | void>;
  pendingLabel?: string;
  /** Ask the creator to confirm before running. Use for anything destructive. */
  confirm?: string;
  /** Toast the server's success message. Default true. */
  toastOnSuccess?: boolean;
  onSuccess?: () => void;
};

/** Button for a one-click server action (delete, mark paid, accept). Reports success and failure as toasts. */
export function ActionButton({ action, pendingLabel, confirm, toastOnSuccess = true, onSuccess, children, disabled, ...props }: Props) {
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const toast = useToast();

  function run() {
    if (busy.current) return;
    if (confirm && !window.confirm(confirm)) return;
    busy.current = true;
    setPending(true);
    void (async () => {
      try {
        const res = await action();
        if (!res) return;
        if (res.ok) {
          if (res.message && toastOnSuccess) toast.push('success', res.message);
          onSuccess?.();
        } else {
          toast.push('error', res.error);
        }
      } catch (err) {
        if (isRedirect(err)) return;
        toast.push('error', NETWORK_ERROR);
      } finally {
        busy.current = false;
        setPending(false);
      }
    })();
  }

  return (
    <Button onClick={run} disabled={pending || disabled} aria-busy={pending} {...props}>
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
