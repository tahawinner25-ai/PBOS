'use client';

import { useId, useRef, useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { deleteAccount } from '@/actions/account';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DELETE_PHRASE, deletionConfirmed } from '@/lib/account';

/**
 * Data export and account deletion. Deletion needs a typed confirmation (no browser dialog, which is
 * hard to use with a screen reader or a switch device), and the result is announced in a live region.
 */
export function AccountDanger() {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const busy = useRef(false);
  const inputId = useId();
  const hintId = useId();
  const confirmed = deletionConfirmed(text);

  async function onDelete() {
    if (busy.current || !confirmed) return;
    busy.current = true;
    setPending(true);
    setMessage(null);
    try {
      const res = await deleteAccount(text);
      if (res.ok) {
        setMessage({ kind: 'success', text: res.message ?? 'Your account was deleted.' });
        // The session no longer exists. Leave the workspace after a moment so the message can be read.
        window.setTimeout(() => window.location.assign('/'), 2500);
        return;
      }
      setMessage({ kind: 'error', text: res.error });
    } catch {
      setMessage({ kind: 'error', text: 'Could not reach the server. Nothing was deleted. Check your connection and try again.' });
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h3 className="text-sm">Download your data</h3>
        <p className="max-w-2xl text-sm text-muted-foreground">
          One JSON file with your profile, ideas, posts, deals, invoices, drafts, publish history, analytics numbers and connection details. Passwords and access tokens are never included.
        </p>
        <Button asChild variant="outline">
          <a href="/api/account/export" download>
            <Download aria-hidden="true" />
            Download my data (JSON)
          </a>
        </Button>
      </div>

      <div className="space-y-3 border-t border-border pt-6">
        <h3 className="text-sm">Delete my account</h3>
        <p className="max-w-2xl text-sm text-muted-foreground">
          This permanently deletes your profile, everything you entered, the files in your library and your sign-in account. It also disconnects YouTube and Instagram and asks them to revoke PBOS’s access.
          Posts already published on those platforms stay where they are. This cannot be undone. Download your data first if you want a copy.
        </p>
        <div className="max-w-sm space-y-1.5">
          <label htmlFor={inputId} className="text-sm font-medium">
            Type {DELETE_PHRASE} to confirm
          </label>
          <Input
            id={inputId}
            value={text}
            onChange={(e: { target: { value: string } }) => setText(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            aria-describedby={hintId}
            disabled={pending}
          />
          <p id={hintId} className="text-xs text-muted-foreground">
            The button below stays off until the word matches.
          </p>
        </div>
        <Button type="button" variant="destructive" onClick={onDelete} disabled={!confirmed || pending} aria-busy={pending}>
          <Trash2 aria-hidden="true" />
          {pending ? 'Deleting…' : 'Delete my account and data'}
        </Button>
        <div aria-live="polite" className="max-w-2xl">
          {message ? (
            <Alert variant={message.kind === 'error' ? 'destructive' : 'success'} title={message.kind === 'error' ? 'Not deleted' : 'Done'}>
              {message.text}
            </Alert>
          ) : null}
        </div>
      </div>
    </div>
  );
}
