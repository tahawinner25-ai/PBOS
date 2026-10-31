'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Bot, Film, Handshake, ImageIcon, LayoutDashboard, Lightbulb, Megaphone, PlugZap, Send, Settings, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/ideas', label: 'Ideas', icon: Lightbulb },
  { href: '/publish', label: 'Publish', icon: Send },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/deals', label: 'Deals', icon: Handshake },
  { href: '/revenue', label: 'Revenue', icon: Wallet },
  { href: '/agent', label: 'Agent', icon: Bot },
  { href: '/library', label: 'Library', icon: ImageIcon },
  { href: '/studio', label: 'Studio', icon: Film },
  { href: '/ads', label: 'Ads', icon: Megaphone },
  { href: '/connections', label: 'Connections', icon: PlugZap },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

export function NavLinks({ orientation }: { orientation: 'vertical' | 'horizontal' }) {
  const pathname = usePathname();
  return (
    <ul className={cn(orientation === 'vertical' ? 'flex flex-col gap-1' : 'flex gap-1 overflow-x-auto px-4 py-2')}>
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <li key={href} className="shrink-0">
            <Link
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                active ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              <Icon aria-hidden="true" className={cn('size-4', active && 'text-primary')} />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
