/**
 * The "get started" checklist on the dashboard: what is done, what is next, and what is switched on for this deployment.
 * Pure. Every item is derived from the creator's real records, never from a stored flag, so it cannot claim progress that
 * did not happen.
 */
export type ChecklistInput = {
  hasName: boolean;
  hasNiche: boolean;
  ideas: number;
  deals: number;
  posts: number;
  loopRan: boolean;
  aiReady: boolean;
  connected: { youtube: boolean; instagram: boolean; gmail: boolean };
};

export type ChecklistItem = { key: string; label: string; hint: string; href: string; done: boolean };

export function buildChecklist(i: ChecklistInput): { items: ChecklistItem[]; done: number; total: number; next: ChecklistItem | null } {
  const items: ChecklistItem[] = [
    { key: 'profile', label: 'Tell PBOS who you are', hint: 'Name and niche, so every suggestion points back to you.', href: '/settings', done: i.hasName && i.hasNiche },
    { key: 'idea', label: 'Add your first idea', hint: 'Ideas are what the agent writes hooks and scripts for.', href: '/ideas', done: i.ideas > 0 },
    { key: 'ai', label: 'Switch on the AI', hint: 'The agent and generators need one AI key on the server. A free Google Gemini key works.', href: '/agent', done: i.aiReady },
    { key: 'loop', label: 'Run the daily loop', hint: 'Scan, flag, suggest and draft from your own records.', href: '/dashboard', done: i.loopRan },
    { key: 'youtube', label: 'Connect YouTube', hint: 'Lets PBOS read your real numbers and publish after you approve.', href: '/connections', done: i.connected.youtube },
    { key: 'instagram', label: 'Connect Instagram', hint: 'Same, for Instagram.', href: '/connections', done: i.connected.instagram },
    { key: 'gmail', label: 'Connect Gmail', hint: 'Lets the agent send an email as you, only when you press Approve.', href: '/connections', done: i.connected.gmail },
    { key: 'deal', label: 'Add a brand deal', hint: 'So PBOS can watch stalled deals and overdue invoices.', href: '/deals', done: i.deals > 0 },
  ];
  const done = items.filter((x) => x.done).length;
  return { items, done, total: items.length, next: items.find((x) => !x.done) ?? null };
}
