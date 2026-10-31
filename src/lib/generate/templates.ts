import type { DealStage } from '../constants';
import { formatDate, formatMoney, truncate } from '../format';
import { daysOverdue } from '../revenue';
import type { CreatorProfile, Deal, RevenueEntry } from '../types';
import { FOLLOWUP_LABELS, type FollowupDraft } from './validators';

/**
 * Deterministic drafts built only from real records. They are used when the AI is unavailable
 * or its output is rejected, and are always labelled as templates in the UI.
 */

const sign = (p: Pick<CreatorProfile, 'name'>) => p.name?.trim() || '[your name]';
const greet = (contact: string | null) => `Hi ${contact?.trim() || 'there'},`;

const STAGE_ASK: Record<DealStage, { subject: (brand: string) => string; lines: (brand: string) => string[] }> = {
  prospecting: {
    subject: (b) => `Collaboration idea for ${b}`,
    lines: (b) => [
      `I would like to explore working with ${b}.`,
      'Would you be open to a short call, or could you point me to the person who handles creator partnerships?',
    ],
  },
  negotiating: {
    subject: (b) => `Next steps on our ${b} collaboration`,
    lines: () => [
      'I wanted to follow up on where we left things.',
      'Is there anything you still need from me to move forward, or any part of the scope you would like to talk through?',
    ],
  },
  contracted: {
    subject: (b) => `Kickoff for the ${b} collaboration`,
    lines: () => [
      'Thank you for confirming. I would like to line up the kickoff.',
      'Could you share the brief, any assets you need me to use, and who will approve the work?',
    ],
  },
  delivery: {
    subject: (b) => `Checking in on the ${b} deliverables`,
    lines: () => [
      'I wanted to check in on the deliverables.',
      'Is everything on track from your side, and is there feedback you would like me to act on?',
    ],
  },
  paid: {
    subject: (b) => `Thank you from me, and what next for ${b}?`,
    lines: () => [
      'Thank you for the collaboration. It was good to work together.',
      'If it makes sense for your team, I would be glad to talk about a follow-up project.',
    ],
  },
};

export function outreachTemplate(
  profile: Pick<CreatorProfile, 'name' | 'niche' | 'positioning'>,
  deal: Pick<Deal, 'brand' | 'contact_name' | 'stage' | 'deliverables'>,
): { subject: string; body: string } {
  const brand = deal.brand?.trim() || 'your team';
  const stage = STAGE_ASK[deal.stage];
  const intro = [
    profile.niche ? `I create content about ${profile.niche}.` : null,
    profile.positioning ? truncate(profile.positioning, 200) : null,
  ]
    .filter(Boolean)
    .join(' ');
  const deliverables = (deal.deliverables ?? []).slice(0, 5);
  const [first, ...rest] = stage.lines(brand);
  const parts = [
    greet(deal.contact_name),
    '',
    deal.stage === 'prospecting' && intro ? `${intro} ${first}` : first,
    ...(deliverables.length
      ? ['', 'Here is what I have in mind:', ...deliverables.map((d) => `- ${truncate(String(d), 120)}`)]
      : []),
    '',
    ...rest,
    '',
    'Thanks,',
    sign(profile),
  ];
  return { subject: stage.subject(brand), body: parts.join('\n') };
}

export function followupTemplates(
  profile: Pick<CreatorProfile, 'name'>,
  invoice: Pick<RevenueEntry, 'amount' | 'currency' | 'due_date' | 'status'>,
  deal: Pick<Deal, 'brand' | 'contact_name'> | null,
  now: Date,
): FollowupDraft[] {
  const brand = deal?.brand?.trim() || 'your team';
  const amount = formatMoney(Number(invoice.amount), invoice.currency);
  const days = daysOverdue(invoice, now);
  const dueClause = invoice.due_date ? `due ${formatDate(invoice.due_date)}` : 'marked as overdue';
  const lateClause = days > 0 ? `${days} days past due` : 'overdue';
  const hello = greet(deal?.contact_name ?? null);
  const bye = ['Thanks,', sign(profile)];

  const level1 = [
    hello,
    '',
    `I hope things are going well. A quick reminder that the invoice for ${amount}, ${dueClause}, is still open on my side. If it has already been paid, thank you, and please ignore this note.`,
    '',
    'Payment details: [payment details]. If anything is holding it up, let me know and I will help sort it out.',
    '',
    ...bye,
  ];
  const level2 = [
    hello,
    '',
    `I am following up on the invoice for ${amount}, which was ${dueClause} and is now ${lateClause}. Could you confirm when I can expect payment, or tell me if there is an issue I can help resolve?`,
    '',
    'Payment details: [payment details]. A reply by [reply-by date] would be appreciated.',
    '',
    ...bye,
  ];
  const level3 = [
    hello,
    '',
    `This is my final reminder about the invoice for ${amount}, ${dueClause} and now ${lateClause}. I would like to get this settled, so please send payment or a firm payment date by [reply-by date].`,
    '',
    'If there is a problem with the invoice, tell me and I will address it right away. Payment details: [payment details].',
    '',
    ...bye,
  ];

  return [
    { level: 1, label: FOLLOWUP_LABELS[1], subject: `Friendly reminder: invoice for ${brand}`, body: level1.join('\n') },
    { level: 2, label: FOLLOWUP_LABELS[2], subject: `Following up: invoice for ${brand}`, body: level2.join('\n') },
    { level: 3, label: FOLLOWUP_LABELS[3], subject: `Final reminder: invoice for ${brand}`, body: level3.join('\n') },
  ];
}
