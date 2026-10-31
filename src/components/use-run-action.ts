'use client';

import { useCallback, useRef, useState } from 'react';
import { isRedirect, NETWORK_ERROR } from '@/components/action-form';
import { useToast } from '@/components/toast';
import type { ActionResult } from '@/lib/types';

type AnyResult = ActionResult<unknown> | undefined | void;

/**
 * Runs a server action from an event handler (a select change, a drop) and reports the outcome as a toast.
 * Resolves to true when the action succeeded. Guards against double-firing while one call is in flight.
 */
export function useRunAction() {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  const run = useCallback(
    async (fn: () => Promise<AnyResult>, options: { toastOnSuccess?: boolean } = {}): Promise<boolean> => {
      if (busy.current) return false;
      busy.current = true;
      setPending(true);
      try {
        const res = await fn();
        if (!res) return true;
        if (res.ok) {
          if (res.message && options.toastOnSuccess !== false) toast.push('success', res.message);
          return true;
        }
        toast.push('error', res.error);
        return false;
      } catch (err) {
        if (isRedirect(err)) return true;
        toast.push('error', NETWORK_ERROR);
        return false;
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [toast],
  );

  return { run, pending };
}
