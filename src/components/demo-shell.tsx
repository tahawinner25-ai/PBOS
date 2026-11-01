import Link from 'next/link';
import { Brand } from '@/components/brand';
import { DemoTimer } from '@/components/demo-timer';
import { NavLinks } from '@/components/nav-links';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DEMO_NAV } from '@/lib/nav';

/**
 * The 10-minute sample workspace: the same sidebar layout as the signed-in app, one page per area.
 * The countdown is only a display. Each page re-checks the signed cookie on the server (see requireDemo).
 */
export function DemoShell({ remainingMs, children }: { remainingMs: number; children: React.ReactNode }) {
  const actions = (
    <>
      <Button asChild size="sm" className="w-full"><Link href="/signup">Create your workspace</Link></Button>
      <form method="post" action="/api/demo/end"><Button type="submit" size="sm" variant="ghost" className="w-full">End demo</Button></form>
    </>
  );
  return (
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden border-r border-border bg-card/40 lg:flex lg:flex-col" aria-label="Sidebar">
        <div className="sticky top-0 flex h-screen flex-col gap-5 p-5">
          <div className="space-y-2">
            <Brand href="/demo/workspace" />
            <Badge variant="warning">Sample data</Badge>
          </div>
          <nav aria-label="Demo pages" className="min-h-0 flex-1 overflow-y-auto pr-1">
            <NavLinks orientation="vertical" groups={DEMO_NAV} exact={['/demo/workspace']} />
          </nav>
          <div className="space-y-2 border-t border-border pt-3">
            <DemoTimer remainingMs={remainingMs} />
            {actions}
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <div className="border-b border-border bg-card/40 lg:hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
            <div className="flex items-center gap-2"><Brand href="/demo/workspace" /><Badge variant="warning">Sample data</Badge></div>
            <DemoTimer remainingMs={remainingMs} />
          </div>
          <nav aria-label="Demo pages"><NavLinks orientation="horizontal" groups={DEMO_NAV} exact={['/demo/workspace']} /></nav>
          <div className="flex gap-2 px-4 pb-3">{actions}</div>
        </div>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  );
}

/** A page of the real product that needs the creator's own accounts or AI keys, so the demo only describes it. */
export function DemoLocked({ title, lead, points, cta = 'Create your workspace' }: { title: string; lead: string; points: Array<[string, string]>; cta?: string }) {
  return (
    <>
      <div className="mb-8">
        <Badge variant="outline">Not active in the demo</Badge>
        <h1 className="mt-3">{title}</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">{lead}</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {points.map(([t, d]) => (
          <li key={t} className="rounded-lg border border-dashed border-border p-4 text-sm"><p className="font-medium">{t}</p><p className="mt-1 text-muted-foreground">{d}</p></li>
        ))}
      </ul>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button asChild><Link href="/signup">{cta}</Link></Button>
        <p className="text-sm text-muted-foreground">Nothing here connects to, or posts to, any account while you are in the demo.</p>
      </div>
    </>
  );
}
