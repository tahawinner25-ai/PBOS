'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Bot, Film, Handshake, ImageIcon, LayoutDashboard, Lightbulb, Megaphone, PlugZap, Send, Settings, Wallet } from 'lucide-react';
import { APP_NAV, type NavGroup, type NavIcon } from '@/lib/nav';
import { cn } from '@/lib/utils';

const ICONS: Record<NavIcon, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard, ideas: Lightbulb, images: ImageIcon, studio: Film, ads: Megaphone, publish: Send,
  analytics: BarChart3, deals: Handshake, revenue: Wallet, agent: Bot, connections: PlugZap, settings: Settings,
};

/**
 * Sidebar (vertical, grouped with headings) or scrolling tab bar (horizontal, flat). Pass `groups` to reuse it,
 * for example for the sample workspace. A link is "current" on its own page and below it, except the root of a
 * section such as /demo/workspace, which is current only on itself.
 */
export function NavLinks({ orientation, groups = APP_NAV, exact = [] }: { orientation: 'vertical' | 'horizontal'; groups?: NavGroup[]; exact?: string[] }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || (!exact.includes(href) && pathname.startsWith(`${href}/`));

  const link = (href: string, label: string, icon: NavIcon) => {
    const Icon = ICONS[icon];
    const active = isActive(href);
    return (
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
    );
  };

  if (orientation === 'horizontal') {
    return (
      <ul className="flex gap-1 overflow-x-auto px-4 py-2">
        {groups.flatMap((g) => g.items).map((i) => <li key={i.href} className="shrink-0">{link(i.href, i.label, i.icon)}</li>)}
      </ul>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="mb-1 px-3 text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground">{g.label}</p>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((i) => <li key={i.href}>{link(i.href, i.label, i.icon)}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}
