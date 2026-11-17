// Sauchatz signs people in with a phone number and password, with no texts.
// Supabase accounts need an email-shaped login, so each phone number is
// stored as a private login address that no one ever sees or emails.
// Example: (423) 555-0134  ->  14235550134@phone.sauchatz.app

export const PHONE_LOGIN_DOMAIN = 'phone.sauchatz.app';

/** Digits only, with a US country code added for 10-digit numbers. Null if invalid. */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  let digits = trimmed.replace(/\D/g, '');
  if (!trimmed.startsWith('+') && digits.length === 10) digits = '1' + digits;
  if (digits.length < 11 || digits.length > 15) return null;
  return digits;
}

export function phoneToLogin(digits: string) {
  return `${digits}@${PHONE_LOGIN_DOMAIN}`;
}

/** Turns a stored login back into a readable phone number, or returns it unchanged. */
export function loginToPhone(login: string | null | undefined): string {
  if (!login) return '';
  const [local, domain] = login.split('@');
  if (domain !== PHONE_LOGIN_DOMAIN) return login;
  return formatPhone(local);
}

export function formatPhone(digits: string) {
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return `+${digits}`;
}

/** Formats as the person types: (423) 555-0134 */
export function formatAsTyped(input: string) {
  if (input.trim().startsWith('+')) return input;
  const d = input.replace(/\D/g, '').slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
