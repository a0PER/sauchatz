import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { getProfile } from '../lib/profileCache';
import type { ConversationSummary, Message } from '../lib/types';
import { APP_NAME } from '../config';
import { useAuth } from './AuthContext';

interface ChatState {
  conversations: ConversationSummary[];
  loaded: boolean;
  totalUnread: number;
  refresh: () => Promise<void>;
  setActiveConversation: (id: string | null) => void;
  markReadLocally: (id: string) => void;
  setMutedLocally: (id: string, muted: boolean) => void;
  setLockedLocally: (id: string, locked: boolean) => void;
  isUnlocked: (id: string) => boolean;
  markUnlocked: (id: string) => void;
  relock: (id?: string) => void;
}

const ChatContext = createContext<ChatState | null>(null);

let audioCtx: AudioContext | null = null;
function playChime() {
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.08, now + i * 0.09 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.09);
      osc.stop(now + i * 0.09 + 0.3);
    });
  } catch {
    /* audio not available */
  }
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const { session, profile, settings } = useAuth();
  const userId = session?.user.id;
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Locked chats opened with the PIN during this visit. Cleared on reload or after 2 minutes away.
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const navigate = useNavigate();
  const navRef = useRef(navigate);
  navRef.current = navigate;
  const activeRef = useRef<string | null>(null);
  const convRef = useRef<ConversationSummary[]>([]);
  const prefsRef = useRef({ profile, settings });
  prefsRef.current = { profile, settings };
  convRef.current = conversations;

  const refresh = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase.rpc('get_my_conversations');
    if (!error && data) {
      const rows = (data as ConversationSummary[]).map((c) => ({
        ...c,
        unread_count: c.id === activeRef.current && document.visibilityState === 'visible' ? 0 : Number(c.unread_count),
        member_count: Number(c.member_count),
      }));
      setConversations(rows);
    }
    setLoaded(true);
  }, [userId]);

  // Collapse bursts of realtime events into one refresh.
  const timer = useRef<number | undefined>(undefined);
  const scheduleRefresh = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(refresh, 250);
  }, [refresh]);

  useEffect(() => {
    if (!userId) {
      setConversations([]);
      setLoaded(false);
      return;
    }
    refresh();

    const notify = async (m: Message) => {
      if (m.sender_id === userId || (m.kind && m.kind !== 'text')) return;
      const conv = convRef.current.find((c) => c.id === m.conversation_id);
      const { profile: me, settings: prefs } = prefsRef.current;
      if (conv?.muted || me?.status === 'dnd') return;
      const viewing = activeRef.current === m.conversation_id && document.visibilityState === 'visible';
      if (viewing) return;
      if (prefs?.notify_sound) playChime();
      if (prefs?.notify_desktop && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
        const sender = m.sender_id ? await getProfile(m.sender_id) : null;
        const title = conv?.type === 'group' ? `${sender?.display_name ?? 'Someone'} in ${conv.name}` : sender?.display_name ?? APP_NAME;
        const n = new Notification(conv?.locked ? 'SAUchatz' : title, {
          body: conv?.locked ? 'New message in a locked chat' : m.deleted_at ? '' : m.body || (m.gif_url ? 'Sent a GIF' : 'Sent a photo'),
          icon: sender?.avatar_url || `${import.meta.env.BASE_URL}icon-192.png`,
          tag: m.conversation_id,
        });
        n.onclick = () => {
          window.focus();
          navRef.current(`/c/${m.conversation_id}`);
          n.close();
        };
      }
    };

    const channel = supabase
      .channel(`inbox:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        notify(payload.new as Message);
        scheduleRefresh();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members', filter: `user_id=eq.${userId}` }, scheduleRefresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations' }, scheduleRefresh)
      .subscribe();

    const onFocus = () => scheduleRefresh();
    window.addEventListener('focus', onFocus);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('focus', onFocus);
    };
  }, [userId, refresh, scheduleRefresh]);

  const totalUnread = useMemo(
    () => conversations.reduce((sum, c) => sum + (c.muted ? 0 : c.unread_count), 0),
    [conversations],
  );

  useEffect(() => {
    document.title = totalUnread > 0 ? `(${totalUnread}) ${APP_NAME}` : APP_NAME;
  }, [totalUnread]);

  const setActiveConversation = useCallback((id: string | null) => { activeRef.current = id; }, []);
  const markReadLocally = useCallback((id: string) =>
    setConversations((list) => (list.some((c) => c.id === id && c.unread_count)
      ? list.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c))
      : list)), []);
  const setMutedLocally = useCallback((id: string, muted: boolean) =>
    setConversations((list) => list.map((c) => (c.id === id ? { ...c, muted } : c))), []);

  const setLockedLocally = useCallback((id: string, locked: boolean) =>
    setConversations((list) => list.map((c) => (c.id === id ? { ...c, locked } : c))), []);
  const isUnlocked = useCallback((id: string) => unlocked.has(id), [unlocked]);
  const markUnlocked = useCallback((id: string) => setUnlocked((s) => new Set(s).add(id)), []);
  const relock = useCallback((id?: string) => setUnlocked((s) => {
    if (!id) return s.size ? new Set() : s;
    const n = new Set(s);
    n.delete(id);
    return n;
  }), []);

  useEffect(() => {
    let timer: number | undefined;
    const onVis = () => {
      window.clearTimeout(timer);
      if (document.hidden) timer = window.setTimeout(() => relock(), 2 * 60 * 1000);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); window.clearTimeout(timer); };
  }, [relock]);

  const value = useMemo<ChatState>(() => ({
    conversations, loaded, totalUnread, refresh, setActiveConversation, markReadLocally, setMutedLocally,
    setLockedLocally, isUnlocked, markUnlocked, relock,
  }), [conversations, loaded, totalUnread, refresh, setActiveConversation, markReadLocally, setMutedLocally, setLockedLocally, isUnlocked, markUnlocked, relock]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChats() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChats must be used inside ChatProvider');
  return ctx;
}
