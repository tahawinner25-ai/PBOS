'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type Kind = 'success' | 'error' | 'info';
type ToastItem = { id: number; kind: Kind; text: string };

const ToastContext = createContext<{ push: (kind: Kind, text: string) => void }>({ push: () => undefined });

export const useToast = () => useContext(ToastContext);

const ICON = { success: CheckCircle2, error: TriangleAlert, info: Info } as const;
const TONE = { success: 'text-success', error: 'text-destructive', info: 'text-muted-foreground' } as const;

/** Confirms what changed after an action. Errors stay longer and are announced assertively. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (kind: Kind, text: string) => {
      const id = nextId.current++;
      setItems((list) => [...list.slice(-3), { id, kind, text }]);
      timers.current.set(id, setTimeout(() => dismiss(id), kind === 'error' ? 9000 : 5000));
    },
    [dismiss],
  );

  useEffect(() => {
    const active = timers.current;
    return () => active.forEach((t) => clearTimeout(t));
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div role="region" aria-label="Notifications" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
        {items.map((t) => {
          const Icon = ICON[t.kind];
          return (
            <div
              key={t.id}
              role={t.kind === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex items-start gap-3 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
            >
              <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', TONE[t.kind])} />
              <p className="min-w-0 flex-1 leading-snug">{t.text}</p>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="-m-1 rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
