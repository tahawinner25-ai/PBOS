/**
 * The app's navigation, as plain data so the signed-in sidebar and the 10-minute demo sidebar stay in step.
 * Every destination is its own page: nothing is hidden behind an anchor on a long page.
 */
export type NavIcon =
  | 'dashboard' | 'ideas' | 'images' | 'studio' | 'ads' | 'publish' | 'analytics' | 'deals' | 'revenue' | 'agent' | 'connections' | 'settings';

export type NavItem = { href: string; label: string; icon: NavIcon };
export type NavGroup = { label: string; items: NavItem[] };

export const APP_NAV: NavGroup[] = [
  { label: 'Overview', items: [{ href: '/dashboard', label: 'Dashboard', icon: 'dashboard' }] },
  {
    label: 'Create',
    items: [
      { href: '/ideas', label: 'Ideation', icon: 'ideas' },
      { href: '/library', label: 'AI images', icon: 'images' },
      { href: '/studio', label: 'Studio', icon: 'studio' },
      { href: '/ads', label: 'Ad drafts', icon: 'ads' },
    ],
  },
  {
    label: 'Grow',
    items: [
      { href: '/publish', label: 'Posting', icon: 'publish' },
      { href: '/analytics', label: 'Analytics', icon: 'analytics' },
    ],
  },
  {
    label: 'Business',
    items: [
      { href: '/deals', label: 'Deals', icon: 'deals' },
      { href: '/revenue', label: 'Revenue', icon: 'revenue' },
    ],
  },
  { label: 'Assistant', items: [{ href: '/agent', label: 'Agent', icon: 'agent' }] },
  {
    label: 'Account',
    items: [
      { href: '/connections', label: 'YouTube & Instagram', icon: 'connections' },
      { href: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
];

const DEMO = '/demo/workspace';

/** The same pages, as they exist in the sample workspace. */
export const DEMO_NAV: NavGroup[] = [
  { label: 'Overview', items: [{ href: DEMO, label: 'Dashboard', icon: 'dashboard' }] },
  {
    label: 'Create',
    items: [
      { href: `${DEMO}/ideas`, label: 'Ideation', icon: 'ideas' },
      { href: `${DEMO}/images`, label: 'AI images', icon: 'images' },
      { href: `${DEMO}/studio`, label: 'Studio', icon: 'studio' },
    ],
  },
  {
    label: 'Grow',
    items: [
      { href: `${DEMO}/posting`, label: 'Posting', icon: 'publish' },
      { href: `${DEMO}/analytics`, label: 'Analytics', icon: 'analytics' },
    ],
  },
  {
    label: 'Business',
    items: [
      { href: `${DEMO}/deals`, label: 'Deals', icon: 'deals' },
      { href: `${DEMO}/revenue`, label: 'Revenue', icon: 'revenue' },
    ],
  },
  { label: 'Assistant', items: [{ href: `${DEMO}/agent`, label: 'Agent', icon: 'agent' }] },
  { label: 'Account', items: [{ href: `${DEMO}/connections`, label: 'YouTube & Instagram', icon: 'connections' }] },
];
