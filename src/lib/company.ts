/**
 * Who operates this PBOS site, for the legal pages. Values come from public environment variables so the
 * operator never edits code. Anything not set shows as a visible [bracketed placeholder], and
 * `unresolvedPlaceholders()` lists what is still missing (the pre-launch checklist reports it).
 */
type Field = { env: string; label: string; value: string | undefined };

function fields(): Field[] {
  return [
    { env: 'NEXT_PUBLIC_COMPANY_NAME', label: 'Company legal name', value: process.env.NEXT_PUBLIC_COMPANY_NAME },
    { env: 'NEXT_PUBLIC_COMPANY_ADDRESS', label: 'Company postal address', value: process.env.NEXT_PUBLIC_COMPANY_ADDRESS },
    { env: 'NEXT_PUBLIC_GOVERNING_LAW', label: 'Governing law and venue', value: process.env.NEXT_PUBLIC_GOVERNING_LAW },
    { env: 'NEXT_PUBLIC_CONTACT_EMAIL', label: 'Contact email', value: process.env.NEXT_PUBLIC_CONTACT_EMAIL },
  ];
}

function pick(env: string): { text: string; placeholder: boolean } {
  const f = fields().find((x) => x.env === env);
  const v = f?.value?.trim();
  return v ? { text: v, placeholder: false } : { text: `[${f?.label ?? env}]`, placeholder: true };
}

export const companyName = () => pick('NEXT_PUBLIC_COMPANY_NAME').text;
export const companyAddress = () => pick('NEXT_PUBLIC_COMPANY_ADDRESS').text;
export const governingLaw = () => pick('NEXT_PUBLIC_GOVERNING_LAW').text;

/** Environment variable names that must be set before the legal pages are final. */
export function unresolvedPlaceholders(): string[] {
  return fields().filter((f) => !f.value?.trim()).map((f) => f.env);
}
