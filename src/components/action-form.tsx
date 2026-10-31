'use client';

import { cloneElement, createContext, isValidElement, useContext, useEffect, useId, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/toast';
import type { ActionResult } from '@/lib/types';
import { cn } from '@/lib/utils';

type AnyResult = ActionResult<unknown> | undefined | void;

type FormState = { pending: boolean; error: string | null; fieldErrors: Record<string, string> };
const FormContext = createContext<FormState>({ pending: false, error: null, fieldErrors: {} });

export const useActionFormState = () => useContext(FormContext);

/** A server action that redirects never resolves with a result; the router handles the navigation. */
export function isRedirect(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'digest' in err && String((err as { digest: unknown }).digest).startsWith('NEXT_REDIRECT'));
}

export const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.';

type ActionFormProps = Omit<React.FormHTMLAttributes<HTMLFormElement>, 'action' | 'onSubmit'> & {
  action: (formData: FormData) => Promise<AnyResult>;
  resetOnSuccess?: boolean;
  /** Show the server's success message as a toast. Default true. */
  toastOnSuccess?: boolean;
  /** Keep the success message on the page instead of a toast (for messages the person must not miss). */
  inlineSuccess?: boolean;
  onSuccess?: (result: Extract<ActionResult<unknown>, { ok: true }>) => void;
};

/**
 * Form that calls a server action, keeps the creator's input on failure, shows a form-level error,
 * marks the fields the server rejected, and confirms success with a toast.
 */
export function ActionForm({ action, resetOnSuccess, toastOnSuccess = true, inlineSuccess = false, onSuccess, className, children, ...rest }: ActionFormProps) {
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (Object.keys(fieldErrors).length === 0) return;
    const first = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    first?.focus();
  }, [fieldErrors]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    busy.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    setFieldErrors({});
    void (async () => {
      try {
        const res = await action(formData);
        if (!res) return;
        if (res.ok) {
          if (res.message && inlineSuccess) setNotice(res.message);
          else if (res.message && toastOnSuccess) toast.push('success', res.message);
          if (resetOnSuccess) form.reset();
          onSuccess?.(res);
        } else {
          setError(res.error);
          setFieldErrors(res.fieldErrors ?? {});
        }
      } catch (err) {
        if (isRedirect(err)) return;
        setError(NETWORK_ERROR);
      } finally {
        busy.current = false;
        setPending(false);
      }
    })();
  }

  return (
    <FormContext.Provider value={{ pending, error, fieldErrors }}>
      <form ref={formRef} onSubmit={handleSubmit} aria-busy={pending} className={className} {...rest}>
        {error ? <Alert variant="destructive" title={error} className="mb-4" /> : null}
        {notice ? <Alert variant="success" title={notice} className="mb-4" /> : null}
        {children}
      </form>
    </FormContext.Provider>
  );
}

type FieldProps = {
  label: string;
  name: string;
  hint?: string;
  required?: boolean;
  className?: string;
  /** Exactly one form control. The field supplies its id, name, error state and description. */
  children: React.ReactElement<Record<string, unknown>>;
};

export function Field({ label, name, hint, required, className, children }: FieldProps) {
  const id = useId();
  const { fieldErrors } = useActionFormState();
  const message = fieldErrors[name];
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, message ? errorId : null].filter(Boolean).join(' ') || undefined;

  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        name,
        'aria-invalid': message ? true : undefined,
        'aria-describedby': describedBy,
        ...(required ? { required: true } : {}),
      })
    : children;

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required ? <span className="ml-0.5 text-muted-foreground" aria-hidden="true">*</span> : null}
      </Label>
      {control}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {message ? (
        <p id={errorId} className="text-xs font-medium text-destructive">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function SubmitButton({ children, pendingLabel = 'Saving…', disabled, ...props }: ButtonProps & { pendingLabel?: string }) {
  const { pending } = useActionFormState();
  return (
    <Button type="submit" disabled={pending || disabled} {...props}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
