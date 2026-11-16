import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && anonKey);

export const supabase = createClient(
  url || 'http://localhost:54321',
  anonKey || 'missing-key',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);

/** Turns a Supabase or network error into a sentence fit for the UI. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!err) return fallback;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = String((err as { message: unknown }).message || '');
    if (/row-level security|permission denied/i.test(msg)) return 'You do not have permission to do that.';
    if (/Failed to fetch|NetworkError/i.test(msg)) return 'Network error. Check your connection.';
    return msg || fallback;
  }
  return fallback;
}

/** Full address of the site, including any sub-folder it is hosted in. */
export function siteUrl() {
  return window.location.origin + import.meta.env.BASE_URL;
}
