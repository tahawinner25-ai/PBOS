'use server';

import { revalidatePath } from 'next/cache';
import { dbFail, fail, ok, withCreator } from '@/lib/action-helpers';
import { DEAL_STAGES } from '@/lib/constants';
import { truncate } from '@/lib/format';
import { deliverablesFromText } from '@/lib/profile-text';
import type { ActionResult, Inquiry } from '@/lib/types';
import { parse, rules } from '@/lib/validation';

const touch = () => ['/deals', '/revenue', '/dashboard'].forEach((p) => revalidatePath(p));

const dealFields = {
  brand: rules.text({ max: 120 }),
  contact_name: rules.optionalText({ max: 120 }),
  contact_email: rules.optionalEmail(),
  stage: rules.oneOf(DEAL_STAGES),
  value: rules.optionalNumber({ min: 0, max: 1_000_000_000 }),
  expected_close_date: rules.optionalDate(),
  deliverables: rules.optionalText({ max: 1500 }),
  notes: rules.optionalText({ max: 2000 }),
};
const dealLabels = {
  brand: 'Brand',
  contact_name: 'Contact name',
  contact_email: 'Contact email',
  value: 'Deal value',
  expected_close_date: 'Expected close date',
  deliverables: 'Deliverables',
};

export async function createDeal(formData: FormData): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    const parsed = parse(formData, dealFields, dealLabels);
    if (!parsed.ok) return fail(parsed.first, parsed.errors);
    const d = parsed.data;
    const deliverables = deliverablesFromText(d.deliverables ?? '');
    if (!deliverables.ok) return fail(deliverables.error, { deliverables: deliverables.error });

    const { error } = await supabase.from('deals').insert({
      creator_id: profile.id,
      brand: d.brand,
      contact_name: d.contact_name,
      contact_email: d.contact_email,
      stage: d.stage,
      value: d.value,
      expected_close_date: d.expected_close_date,
      deliverables: deliverables.value,
      notes: d.notes,
    });
    if (error) return dbFail('createDeal', error);
    touch();
    return ok('Deal added.');
  });
}

export async function updateDeal(formData: FormData): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    const parsed = parse(formData, { id: rules.uuid(), ...dealFields }, { ...dealLabels, id: 'Deal' });
    if (!parsed.ok) return fail(parsed.first, parsed.errors);
    const { id, deliverables: rawDeliverables, ...d } = parsed.data;
    const deliverables = deliverablesFromText(rawDeliverables ?? '');
    if (!deliverables.ok) return fail(deliverables.error, { deliverables: deliverables.error });

    const { error } = await supabase
      .from('deals')
      .update({ ...d, deliverables: deliverables.value })
      .eq('id', id)
      .eq('creator_id', profile.id);
    if (error) return dbFail('updateDeal', error);
    touch();
    return ok('Deal updated.');
  });
}

/** Drag-and-drop target. The database trigger resets the days-in-stage clock when the stage changes. */
export async function moveDeal(id: string, stage: string): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    const idRes = rules.uuid()(id, 'Deal');
    if (!idRes.ok) return fail(idRes.error);
    const stageRes = rules.oneOf(DEAL_STAGES)(stage, 'Stage');
    if (!stageRes.ok) return fail(stageRes.error);
    const { data, error } = await supabase
      .from('deals')
      .update({ stage: stageRes.value })
      .eq('id', idRes.value)
      .eq('creator_id', profile.id)
      .select('id');
    if (error) return dbFail('moveDeal', error);
    if (!data || data.length === 0) return fail('That deal no longer exists.');
    touch();
    return ok(`Moved to ${stageRes.value}.`);
  });
}

export async function deleteDeal(id: string): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    const v = rules.uuid()(id, 'Deal');
    if (!v.ok) return fail(v.error);
    const { error } = await supabase.from('deals').delete().eq('id', v.value).eq('creator_id', profile.id);
    if (error) return dbFail('deleteDeal', error);
    touch();
    return ok('Deal deleted. Linked invoices were kept.');
  });
}

export async function createDealFromInquiry(inquiryId: string): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    const v = rules.uuid()(inquiryId, 'Inquiry');
    if (!v.ok) return fail(v.error);
    const { data, error: readError } = await supabase.from('inquiries').select('*').eq('id', v.value).eq('creator_id', profile.id).maybeSingle();
    if (readError) return dbFail('createDealFromInquiry read', readError);
    if (!data) return fail('That inquiry no longer exists.');
    const inquiry = data as Inquiry;

    const { error } = await supabase.from('deals').insert({
      creator_id: profile.id,
      brand: inquiry.company || inquiry.name,
      contact_name: inquiry.name,
      contact_email: inquiry.email,
      stage: 'prospecting',
      notes: `Inbound inquiry: ${truncate(inquiry.message, 600)}`,
    });
    if (error) return dbFail('createDealFromInquiry', error);
    await supabase.from('inquiries').update({ status: 'converted' }).eq('id', inquiry.id).eq('creator_id', profile.id);
    touch();
    return ok('Deal created in Prospecting.');
  });
}

export async function setInquiryStatus(id: string, status: string): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    const idRes = rules.uuid()(id, 'Inquiry');
    if (!idRes.ok) return fail(idRes.error);
    const s = rules.oneOf(['new', 'read', 'archived'] as const)(status, 'Status');
    if (!s.ok) return fail(s.error);
    const { error } = await supabase.from('inquiries').update({ status: s.value }).eq('id', idRes.value).eq('creator_id', profile.id);
    if (error) return dbFail('setInquiryStatus', error);
    touch();
    return ok();
  });
}
