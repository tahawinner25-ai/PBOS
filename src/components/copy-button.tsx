'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API can be blocked (insecure context, permissions). Fall back to a temporary textarea.
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const done = document.execCommand('copy');
      document.body.removeChild(area);
      return done;
    } catch {
      return false;
    }
  }
}

export function CopyButton({ text, label = 'Copy', variant = 'outline', size = 'sm', ...props }: Omit<ButtonProps, 'onClick' | 'children'> & { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function onClick() {
    const done = await copyText(text);
    setState(done ? 'copied' : 'failed');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2200);
  }

  return (
    <>
      <Button variant={variant} size={size} onClick={onClick} {...props}>
        {state === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {state === 'copied' ? 'Copied' : label}
      </Button>
      <span role="status" className="sr-only">
        {state === 'copied' ? 'Copied to clipboard' : state === 'failed' ? 'Copy failed. Select the text and copy it manually.' : ''}
      </span>
    </>
  );
}
