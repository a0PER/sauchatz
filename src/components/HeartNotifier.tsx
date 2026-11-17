import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, useMe } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { getProfile, getProfiles } from '../lib/profileCache';
import { supabase } from '../lib/supabase';

interface HeartRow { from_user: string; to_user: string; created_at: string }

const seenKey = (uid: string) => `sauchatz-hearts-seen:${uid}`;
const firstName = (name?: string | null) => (name ?? 'Someone').split(' ')[0];

/** Tells you when someone sends you a heart: live, and the ones that came while you were away. */
export function HeartNotifier() {
  const { userId } = useMe();
  const { settings, profile } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const prefs = useRef({ settings, profile, toast, navigate });
  prefs.current = { settings, profile, toast, navigate };

  useEffect(() => {
    let alive = true;
    const markSeen = () => { try { localStorage.setItem(seenKey(userId), new Date().toISOString()); } catch { /* storage unavailable */ } };

    // Hearts that arrived since this device last checked.
    (async () => {
      let since: string | null = null;
      try { since = localStorage.getItem(seenKey(userId)); } catch { /* storage unavailable */ }
      if (!since) return markSeen();
      const { data } = await supabase
        .from('profile_hearts')
        .select('from_user, to_user, created_at')
        .eq('to_user', userId)
        .gt('created_at', since)
        .order('created_at', { ascending: false });
      if (!alive) return;
      markSeen();
      const rows = (data ?? []) as HeartRow[];
      if (!rows.length) return;
      const people = await getProfiles(rows.map((r) => r.from_user));
      const first = firstName(people.get(rows[0].from_user)?.display_name);
      prefs.current.toast(
        rows.length === 1 ? `❤️ ${first} sent you a heart` : `❤️ ${first} and ${rows.length - 1} more sent you hearts`,
        'info',
      );
    })();

    // Hearts that arrive while the site is open.
    const channel = supabase
      .channel(`hearts:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'profile_hearts', filter: `to_user=eq.${userId}` }, async (payload) => {
        const row = payload.new as HeartRow;
        markSeen();
        const sender = await getProfile(row.from_user);
        const name = firstName(sender?.display_name);
        const { settings: s, profile: me, toast: show, navigate: go } = prefs.current;
        show(`❤️ ${name} sent you a heart`, 'info');
        if (me?.status === 'dnd') return;
        if (s?.notify_desktop && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
          const n = new Notification(`${name} sent you a heart`, {
            body: 'Tap to see their profile',
            icon: sender?.avatar_url || `${import.meta.env.BASE_URL}icon-192.png`,
            tag: `heart:${row.from_user}`,
          });
          n.onclick = () => { window.focus(); go(`/u/${row.from_user}`); n.close(); };
        }
      })
      .subscribe();

    return () => { alive = false; supabase.removeChannel(channel); };
  }, [userId]);

  return null;
}
