const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const shortDateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const longDateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const fullDateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
const monthYearFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function sameDay(a: string, b: string) {
  return startOfDay(new Date(a)) === startOfDay(new Date(b));
}

export function formatTime(iso: string) {
  return timeFmt.format(new Date(iso));
}

/** Compact stamp for the conversation list: 3:42 PM, Mon, Mar 4. */
export function formatListTime(iso: string) {
  const d = new Date(iso);
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
  if (days === 0) return timeFmt.format(d);
  if (days < 7) return weekdayFmt.format(d);
  return shortDateFmt.format(d);
}

/** Divider label inside a chat: Today, Yesterday, Monday, March 4. */
export function formatDayDivider(iso: string) {
  const d = new Date(iso);
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (d.getFullYear() !== new Date().getFullYear()) return fullDateFmt.format(d);
  return longDateFmt.format(d);
}

export function formatFullDate(iso: string) {
  return fullDateFmt.format(new Date(iso));
}

export function formatMonthYear(iso: string) {
  return monthYearFmt.format(new Date(iso));
}

export function initials(name: string | null | undefined) {
  const parts = (name || '?').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_COLORS = [
  ['#e3ecfd', '#1a4fa8'],
  ['#e1f3e8', '#1d6b3a'],
  ['#fdeee0', '#9a4a0b'],
  ['#f3e6f8', '#7a2e95'],
  ['#e0f2f4', '#0e6670'],
  ['#fbe7ea', '#a3243c'],
  ['#ecebfd', '#4338a6'],
  ['#f2efe2', '#6b5a14'],
];

export function avatarColors(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function statusLabel(s: string) {
  switch (s) {
    case 'active': return 'Active';
    case 'away': return 'Away';
    case 'dnd': return 'Do not disturb';
    default: return 'Offline';
  }
}

export function plural(n: number, word: string, pluralWord = word + 's') {
  return `${n} ${n === 1 ? word : pluralWord}`;
}
