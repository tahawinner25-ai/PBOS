import { dark } from '@clerk/themes';

/**
 * Clerk components restyled to the PBOS desk: dark indigo surfaces with brass as the one accent.
 * Hex values are the sRGB equivalents of the tokens in globals.css (Clerk needs literal colours).
 */
export const clerkAppearance = {
  baseTheme: dark,
  variables: {
    colorPrimary: '#d8aa5a',
    colorTextOnPrimaryBackground: '#10121e',
    colorBackground: '#171926',
    colorInputBackground: '#11121d',
    colorInputText: '#efece6',
    colorText: '#efece6',
    colorTextSecondary: '#a2a6b9',
    colorDanger: '#de6868',
    colorSuccess: '#58bb8d',
    colorWarning: '#eea34f',
    borderRadius: '0.5rem',
    fontFamily: 'var(--font-sans), ui-sans-serif, system-ui, sans-serif',
  },
  // Social sign-in (Google) is switched on in the Clerk Dashboard, not here. When it is on, Clerk shows the
  // buttons above the email form as full-width blocks, which are large enough to tap and read with a screen reader.
  layout: {
    socialButtonsPlacement: 'top',
    socialButtonsVariant: 'blockButton',
  },
  elements: {
    rootBox: 'mx-auto w-full',
    cardBox: 'w-full shadow-none',
    card: 'border border-border shadow-none',
  },
};
