import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { ArrowLeft, Info, Lock, LockKeyhole, MessageSquareOff, Users } from 'lucide-react';
import { EnterPinDialog, ForgotPinDialog } from '../components/ChatPin';
import { MESSAGE_PAGE_SIZE } from '../config';
import { useAuth, useMe } from '../contexts/AuthContext';
import { useChats } from '../contexts/ChatContext';
import { usePresence } from '../contexts/PresenceContext';
import { useToast } from '../contexts/ToastContext';
import { formatDayDivider, plural, sameDay, statusLabel } from '../lib/format';
import { makeBlurPreview, uploadChatImage } from '../lib/images';
import { cacheProfile } from '../lib/profileCache';
import { errorMessage, supabase } from '../lib/supabase';
import type { Conversation, Member, Message, Reaction } from '../lib/types';
import { Avatar, Button, EmptyState, IconButton, Spinner } from '../components/ui';
import { MessageItem, type ReactionSummary } from '../components/chat/MessageItem';
import { chatBackgroundCss, useLayout } from '../lib/layout';
import { Composer } from '../components/chat/Composer';
import { DetailsPanel } from '../components/chat/DetailsPanel';
import { ConfirmDialog, ReportDialog } from '../components/Dialogs';
import { Lightbox } from '../components/Lightbox';

const DETAILS_KEY = 'sauchatz-details-open';

function sortByTime(list: Message[]) {
  return [...list].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

function ChatRoom() {
  const { id = '' } = useParams();
  const { userId, profile: me } = useMe();
  const { settings } = useAuth();
  const layout = useLayout();
  const { conversations, setActiveConversation, markReadLocally, refresh: refreshList, relock } = useChats();
  const { presenceOf } = usePresence();
  const toast = useToast();
  const navigate = useNavigate();

  const [conv, setConv] = useState<Conversation | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [blockedByMe, setBlockedByMe] = useState(false);
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Message | null>(null);
  const [reporting, setReporting] = useState<Message | null>(null);
  const [lightbox, setLightbox] = useState<{ srcs: string[]; index: number } | null>(null);
  const [showDetails, setShowDetails] = useState(() => {
    try { return localStorage.getItem(DETAILS_KEY) !== '0' && window.innerWidth >= 1280; } catch { return false; }
  });
  const [dragging, setDragging] = useState(false);
  const [droppedFile, setDroppedFile] = useState<File | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastTypingSent = useRef(0);

  const memberMap = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members]);
  const firstName = (uid: string) => memberMap.get(uid)?.profile?.display_name?.split(' ')[0] ?? 'one person';
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const reactionMap = useMemo(() => {
    const map = new Map<string, ReactionSummary[]>();
    const byMsg = new Map<string, Reaction[]>();
    reactions.forEach((r) => byMsg.set(r.message_id, [...(byMsg.get(r.message_id) ?? []), r]));
    byMsg.forEach((list, msgId) => {
      const groups = new Map<string, Reaction[]>();
      list.forEach((r) => groups.set(r.emoji, [...(groups.get(r.emoji) ?? []), r]));
      map.set(msgId, [...groups.entries()].map(([emoji, rs]) => ({
        emoji,
        count: rs.length,
        mine: rs.some((r) => r.user_id === userId),
        names: rs.map((r) => (r.user_id === userId ? 'You' : memberMap.get(r.user_id)?.profile?.display_name ?? 'Someone')),
      })));
    });
    return map;
  }, [reactions, memberMap, userId]);

  useEffect(() => {
    setReactions([]);
    supabase.from('message_reactions').select('*').eq('conversation_id', id).then(({ data }) => setReactions((data as Reaction[]) ?? []));
  }, [id]);

  const toggleReaction = useCallback(async (messageId: string, emoji: string) => {
    const mine = reactions.find((r) => r.message_id === messageId && r.user_id === userId && r.emoji === emoji);
    if (mine) {
      setReactions((list) => list.filter((r) => r !== mine));
      await supabase.from('message_reactions').delete().eq('message_id', messageId).eq('user_id', userId).eq('emoji', emoji);
    } else {
      const row: Reaction = { message_id: messageId, conversation_id: id, user_id: userId, emoji, created_at: new Date().toISOString() };
      setReactions((list) => [...list, row]);
      const { error } = await supabase.from('message_reactions').insert({ message_id: messageId, conversation_id: id, emoji });
      if (error) {
        setReactions((list) => list.filter((r) => r !== row));
        toast(errorMessage(error), 'error');
      }
    }
  }, [reactions, userId, id, toast]);
  const other = conv?.type === 'direct' ? members.find((m) => m.user_id !== userId) : undefined;
  const summary = conversations.find((c) => c.id === id);
  const title = conv?.type === 'group' ? conv.name ?? 'Group' : other?.profile?.display_name ?? summary?.other_display_name ?? 'Deleted user';

  /* ---------- Loading ---------- */

  const loadMembers = useCallback(async () => {
    const { data } = await supabase.from('conversation_members').select('*, profile:profiles(*)').eq('conversation_id', id);
    const list = (data as Member[] | null) ?? [];
    list.forEach((m) => m.profile && cacheProfile(m.profile));
    setMembers(list);
    return list;
  }, [id]);

  const markRead = useCallback(async (latest?: string) => {
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    const stamp = new Date(latest && Date.parse(latest) > now ? Date.parse(latest) : now).toISOString();
    markReadLocally(id);
    await supabase.from('conversation_members').update({ last_read_at: stamp }).eq('conversation_id', id).eq('user_id', userId);
  }, [id, userId, markReadLocally]);

  useEffect(() => {
    let alive = true;
    setState('loading');
    setConv(null);
    setMessages([]);
    setMembers([]);
    setEditingId(null);
    setTyping({});
    stickToBottom.current = true;
    setActiveConversation(id);

    (async () => {
      const [{ data: c }, list, { data: msgs }] = await Promise.all([
        supabase.from('conversations').select('*').eq('id', id).maybeSingle(),
        loadMembers(),
        supabase.from('messages').select('*').eq('conversation_id', id).order('created_at', { ascending: false }).limit(MESSAGE_PAGE_SIZE),
      ]);
      if (!alive) return;
      if (!c) return setState('missing');
      setConv(c as Conversation);
      const rows = (msgs as Message[] | null) ?? [];
      setMessages(rows.reverse());
      setHasMore(rows.length === MESSAGE_PAGE_SIZE);
      const o = (c as Conversation).type === 'direct' ? list.find((m) => m.user_id !== userId) : undefined;
      if (o) {
        const { data: b } = await supabase.from('blocks').select('blocked_id').eq('blocked_id', o.user_id).maybeSingle();
        if (alive) setBlockedByMe(Boolean(b));
      } else setBlockedByMe(false);
      setState('ready');
      markRead(rows[0]?.created_at);
    })();

    return () => {
      alive = false;
      setActiveConversation(null);
    };
  }, [id, userId, loadMembers, markRead, setActiveConversation]);

  /* ---------- Realtime ---------- */

  useEffect(() => {
    const upsert = (m: Message) =>
      setMessages((list) => {
        const i = list.findIndex((x) => x.id === m.id);
        if (i === -1) return sortByTime([...list, m]);
        const next = [...list];
        next[i] = { ...m, localImage: list[i].localImage };
        return next;
      });

    const channel = supabase
      .channel(`room:${id}`, { config: { broadcast: { self: false } } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` }, (p) => {
        const m = p.new as Message;
        upsert(m);
        if (m.sender_id !== userId) {
          markRead(m.created_at);
          if (m.sender_id) setTyping((t) => { const n = { ...t }; delete n[m.sender_id!]; return n; });
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` }, (p) => upsert(p.new as Message))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members', filter: `conversation_id=eq.${id}` }, (p) => {
        if (p.eventType === 'UPDATE') {
          const row = p.new as Member;
          setMembers((list) => list.map((m) => (m.user_id === row.user_id ? { ...m, ...row, profile: m.profile } : m)));
        } else loadMembers();
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'conversation_members' }, (p) => {
        if ((p.old as Partial<Member>).conversation_id === id) loadMembers();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations', filter: `id=eq.${id}` }, (p) => setConv(p.new as Conversation))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions', filter: `conversation_id=eq.${id}` }, (p) => {
        const r = p.new as Reaction;
        setReactions((list) => (list.some((x) => x.message_id === r.message_id && x.user_id === r.user_id && x.emoji === r.emoji) ? list : [...list, r]));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions' }, (p) => {
        const r = p.old as Partial<Reaction>;
        if (r.conversation_id !== id) return;
        setReactions((list) => list.filter((x) => !(x.message_id === r.message_id && x.user_id === r.user_id && x.emoji === r.emoji)));
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload.user_id === userId) return;
        setTyping((t) => ({ ...t, [payload.user_id]: { name: payload.name, until: Date.now() + 4000 } }));
      })
      .subscribe();
    channelRef.current = channel;

    const onVisible = () => document.visibilityState === 'visible' && markRead();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [id, userId, loadMembers, markRead]);

  // If I was removed from the group, leave the page.
  useEffect(() => {
    if (state === 'ready' && members.length > 0 && !memberMap.has(userId)) {
      toast('You are no longer in this conversation.');
      refreshList();
      navigate('/', { replace: true });
    }
  }, [state, members, memberMap, userId, navigate, toast, refreshList]);

  // Expire typing indicators.
  useEffect(() => {
    if (Object.keys(typing).length === 0) return;
    const t = setInterval(() => {
      setTyping((cur) => {
        const now = Date.now();
        const next = Object.fromEntries(Object.entries(cur).filter(([, v]) => v.until > now));
        return Object.keys(next).length === Object.keys(cur).length ? cur : next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [typing]);

  /* ---------- Scrolling ---------- */

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, typing, state]);

  // Keep the view pinned to the newest message while photos finish loading.
  useEffect(() => {
    const el = content.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const s = scroller.current;
      if (s && stickToBottom.current) s.scrollTop = s.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [state]);

  async function loadOlder() {
    if (loadingOlder || !hasMore || messages.length === 0) return;
    const el = scroller.current;
    const prevHeight = el?.scrollHeight ?? 0;
    setLoadingOlder(true);
    const { data } = await supabase
      .from('messages').select('*').eq('conversation_id', id)
      .lt('created_at', messages[0].created_at)
      .order('created_at', { ascending: false }).limit(MESSAGE_PAGE_SIZE);
    const rows = ((data as Message[] | null) ?? []).reverse();
    setHasMore(rows.length === MESSAGE_PAGE_SIZE);
    stickToBottom.current = false;
    setMessages((list) => [...rows, ...list]);
    setLoadingOlder(false);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - prevHeight + el.scrollTop;
    });
  }

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 150) loadOlder();
  }

  /* ---------- Actions ---------- */

  async function send(body: string, file: File | null, privateTo: string | null = null, gifUrl: string | null = null) {
    // Private photos carry no caption, so any text goes out as its own normal message first.
    if (privateTo && file && body.trim()) {
      await send(body, null);
      body = '';
    }
    const msgId = crypto.randomUUID();
    const temp: Message = {
      id: msgId, conversation_id: id, sender_id: userId, body, image_path: null, gif_url: gifUrl, recipient_id: privateTo,
      created_at: new Date().toISOString(), edited_at: null, deleted_at: null,
      pending: true, localImage: file ? URL.createObjectURL(file) : undefined,
    };
    stickToBottom.current = true;
    setMessages((list) => [...list, temp]);
    try {
      const image_path = file ? await uploadChatImage(id, file, privateTo ? { recipient: privateTo, sender: userId } : undefined) : null;
      const image_blur = file && privateTo ? await makeBlurPreview(file) : null;
      const { data, error } = await supabase
        .from('messages')
        .insert({ id: msgId, conversation_id: id, sender_id: userId, body, image_path, image_blur, gif_url: gifUrl, recipient_id: privateTo })
        .select()
        .single();
      if (error) throw error;
      setMessages((list) => sortByTime(list.map((m) => (m.id === msgId ? { ...(data as Message), localImage: m.localImage } : m))));
    } catch (e) {
      setMessages((list) => list.filter((m) => m.id !== msgId));
      toast(/permission/i.test(errorMessage(e)) ? 'Your message could not be delivered.' : errorMessage(e), 'error');
    }
  }

  async function saveEdit(m: Message, body: string) {
    setEditingId(null);
    if (body === m.body) return;
    setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, body, edited_at: new Date().toISOString() } : x)));
    const { error } = await supabase.from('messages').update({ body }).eq('id', m.id);
    if (error) toast(errorMessage(error), 'error');
  }

  async function confirmDelete() {
    if (!deleting) return;
    const { error } = await supabase.from('messages').update({ deleted_at: new Date().toISOString() }).eq('id', deleting.id);
    if (error) return toast(errorMessage(error), 'error');
    setMessages((list) => list.map((x) => (x.id === deleting.id ? { ...x, body: '', image_path: null, localImage: undefined, deleted_at: new Date().toISOString() } : x)));
  }

  function sendTyping() {
    const now = Date.now();
    if (now - lastTypingSent.current < 2500) return;
    lastTypingSent.current = now;
    channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { user_id: userId, name: me.display_name } });
  }

  async function unblock() {
    if (!other) return;
    const { error } = await supabase.from('blocks').delete().eq('blocked_id', other.user_id);
    if (error) return toast(errorMessage(error), 'error');
    setBlockedByMe(false);
  }

  function toggleDetails() {
    setShowDetails((s) => {
      try { localStorage.setItem(DETAILS_KEY, s ? '0' : '1'); } catch { /* ignore */ }
      return !s;
    });
  }

  /* ---------- Read receipts ---------- */

  const receipt = useMemo(() => {
    if (!me.show_read_receipts) return null;
    const mine = [...messages].reverse().find((m) => m.sender_id === userId && !m.pending && !m.deleted_at);
    if (!mine) return null;
    const readers = members.filter(
      (m) => m.user_id !== userId && m.profile?.show_read_receipts && Date.parse(m.last_read_at) >= Date.parse(mine.created_at),
    );
    if (readers.length === 0) return null;
    const label = conv?.type === 'direct' ? 'Seen' : readers.length === members.length - 1 ? 'Seen by everyone' : `Seen by ${plural(readers.length, 'person', 'people')}`;
    return { messageId: mine.id, label };
  }, [messages, members, userId, conv?.type, me.show_read_receipts]);

  /* ---------- Render ---------- */

  if (state === 'missing') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          icon={<MessageSquareOff size={26} />}
          title="Conversation not found"
          body="It may have been deleted, or you are no longer a member."
          action={<Button variant="secondary" onClick={() => navigate('/')}>Go back</Button>}
        />
      </div>
    );
  }

  const otherPresence = other?.profile ? presenceOf(other.user_id, other.profile.status) : 'offline';
  const typingNames = Object.values(typing).map((t) => t.name.split(' ')[0]);
  const lightboxSrcs = lightbox?.srcs ?? [];
  const canSend = conv && (conv.type === 'group' || (other && !blockedByMe));
  const enterToSend = settings?.enter_to_send ?? true;

  return (
    <div className="relative flex min-h-0 flex-1">
      <section
        className="relative flex min-w-0 flex-1 flex-col"
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
          if (f && canSend) setDroppedFile(f);
        }}
      >
        {/* Header */}
        <header className="flex h-16 shrink-0 items-center gap-2 border-b border-line px-2 sm:px-4">
          <IconButton label="Back" className="md:hidden" onClick={() => navigate('/')}>
            <ArrowLeft size={20} />
          </IconButton>
          {conv ? (
            <button
              onClick={() => (conv.type === 'direct' && other ? navigate(`/u/${other.user_id}`) : toggleDetails())}
              className="flex min-w-0 items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-surface-2"
            >
              {conv.type === 'direct' ? (
                <Avatar src={other?.profile?.avatar_url} name={title} seed={other?.user_id ?? id} size={36} presence={otherPresence} />
              ) : (
                <Avatar src={conv.avatar_url} name={conv.name} seed={conv.id} size={36} square />
              )}
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-ink">{title}</div>
                <div className="truncate text-xs text-muted">
                  {conv.type === 'group' ? plural(members.length, 'member') : other ? statusLabel(otherPresence) : 'This account was deleted'}
                </div>
              </div>
            </button>
          ) : (
            <div className="h-9 w-48 animate-pulse rounded-lg bg-surface-2" />
          )}
          <div className="ml-auto flex items-center gap-1">
            {summary?.locked && (
              <IconButton label="Lock this chat now" onClick={() => { relock(id); navigate('/'); }}>
                <Lock size={18} />
              </IconButton>
            )}
            {conv?.type === 'group' && (
              <IconButton label="Members" onClick={toggleDetails} className="hidden sm:inline-flex">
                <Users size={19} />
              </IconButton>
            )}
            <IconButton label="Conversation details" active={showDetails} onClick={toggleDetails}>
              <Info size={20} />
            </IconButton>
          </div>
        </header>

        {/* Messages */}
        <div
          ref={scroller}
          onScroll={onScroll}
          className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-3"
          style={{ background: chatBackgroundCss(layout.background, document.documentElement.classList.contains('dark')) }}
        >
          {state === 'loading' ? (
            <div className="flex h-full items-center justify-center"><Spinner size={24} /></div>
          ) : (
            <div ref={content}>
              {loadingOlder && <div className="flex justify-center py-3"><Spinner /></div>}
              {!hasMore && conv && <ConversationIntro conv={conv} title={title} other={other} />}
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const newDay = !prev || !sameDay(prev.created_at, m.created_at);
                const compact = !newDay && !!prev && prev.sender_id === m.sender_id && !prev.deleted_at
                  && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000;
                const sender = m.sender_id ? memberMap.get(m.sender_id)?.profile ?? (m.sender_id === userId ? me : undefined) : undefined;
                const next = messages[i + 1];
                const nextSame = !!next && next.sender_id === m.sender_id && !next.deleted_at && sameDay(next.created_at, m.created_at)
                  && new Date(next.created_at).getTime() - new Date(m.created_at).getTime() < 5 * 60 * 1000;
                return (
                  <div key={m.id}>
                    {newDay && (
                      <div className="flex items-center gap-3 px-5 pb-1 pt-5">
                        <div className="h-px flex-1 bg-line" />
                        <span className="text-xs font-medium text-muted">{formatDayDivider(m.created_at)}</span>
                        <div className="h-px flex-1 bg-line" />
                      </div>
                    )}
                    <MessageItem
                      message={m}
                      sender={sender ?? undefined}
                      mine={m.sender_id === userId}
                      compact={compact}
                      editing={editingId === m.id}
                      enterToSend={enterToSend}
                      onStartEdit={() => setEditingId(m.id)}
                      onCancelEdit={() => setEditingId(null)}
                      onSaveEdit={(body) => saveEdit(m, body)}
                      onDelete={() => setDeleting(m)}
                      onReport={() => setReporting(m)}
                      onCopy={() => navigator.clipboard?.writeText(m.body).then(() => toast('Copied'))}
                      onOpenImage={(src) => setLightbox({ srcs: [src], index: 0 })}
                      reactions={reactionMap.get(m.id)}
                      onReact={m.pending ? undefined : (emoji) => toggleReaction(m.id, emoji)}
                      privateLabel={m.recipient_id ? (m.sender_id === userId ? `Only ${firstName(m.recipient_id)} can see this` : m.recipient_id === userId ? 'Private photo, sent only to you' : `Private photo for ${firstName(m.recipient_id)}`) : undefined}
                      lockedPhoto={!!m.recipient_id && m.sender_id !== userId && m.recipient_id !== userId}
                      bubbles={layout.messageStyle === 'bubbles'}
                      dense={layout.density === 'compact'}
                      nextSame={nextSame}
                      showName={conv?.type === 'group'}
                      footer={
                        receipt?.messageId === m.id ? (
                          <div className="mt-0.5 text-right text-[11px] text-subtle">{receipt.label}</div>
                        ) : m.pending ? (
                          <div className="mt-0.5 text-[11px] text-subtle">Sending...</div>
                        ) : null
                      }
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Typing indicator */}
        <div className="h-5 shrink-0 px-6 text-xs text-muted" aria-live="polite">
          {typingNames.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-flex gap-0.5">
                <span className="typing-dot size-1 rounded-full bg-muted" />
                <span className="typing-dot size-1 rounded-full bg-muted [animation-delay:150ms]" />
                <span className="typing-dot size-1 rounded-full bg-muted [animation-delay:300ms]" />
              </span>
              {typingNames.length === 1 ? `${typingNames[0]} is typing` : typingNames.length === 2 ? `${typingNames[0]} and ${typingNames[1]} are typing` : 'Several people are typing'}
            </span>
          )}
        </div>

        {/* Composer */}
        {state !== 'ready' ? (
          <div className="h-[70px] shrink-0" />
        ) : blockedByMe ? (
          <div className="m-4 mt-1 flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-5 py-3.5 text-sm text-muted">
            <span>You blocked {title}. They cannot message you.</span>
            <Button size="sm" variant="secondary" onClick={unblock}>Unblock</Button>
          </div>
        ) : conv?.type === 'direct' && !other ? (
          <div className="m-4 mt-1 rounded-2xl bg-surface-2 px-5 py-3.5 text-sm text-muted">This person deleted their account.</div>
        ) : (
          <Composer
            placeholder={conv?.type === 'group' ? `Message ${conv.name}` : `Message ${title}`}
            enterToSend={enterToSend}
            onSend={send}
            onTyping={sendTyping}
            droppedFile={droppedFile}
            onDroppedFileUsed={() => setDroppedFile(null)}
            onSendGif={(url) => send('', null, null, url)}
            members={conv?.type === 'group' ? members.filter((m) => m.user_id !== userId && m.profile).map((m) => ({ id: m.user_id, name: m.profile!.display_name })) : undefined}
          />
        )}

        {dragging && canSend && (
          <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-accent-soft/80 text-sm font-medium text-on-accent-soft">
            Drop a photo to send it
          </div>
        )}
      </section>

      {showDetails && conv && (
        <DetailsPanel
          conv={conv}
          members={members}
          messages={messages}
          muted={summary?.muted ?? memberMap.get(userId)?.muted ?? false}
          blockedByMe={blockedByMe}
          onBlockedChange={setBlockedByMe}
          onClose={toggleDetails}
          onMembersChanged={loadMembers}
          onOpenImage={(srcs, index) => setLightbox({ srcs, index })}
        />
      )}

      <Lightbox
        items={lightboxSrcs.map((src) => ({ src }))}
        index={lightbox?.index ?? null}
        onClose={() => setLightbox(null)}
        onIndexChange={(i) => setLightbox((l) => (l ? { ...l, index: i } : l))}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete message?"
        body="This message will be removed for everyone in the conversation."
        confirmLabel="Delete"
        danger
        onConfirm={confirmDelete}
      />
      {reporting?.sender_id && (
        <ReportDialog
          open
          onClose={() => setReporting(null)}
          userId={reporting.sender_id}
          userName={memberMap.get(reporting.sender_id)?.profile?.display_name ?? 'this person'}
          messageId={reporting.id}
        />
      )}
    </div>
  );
}

function ConversationIntro({ conv, title, other }: { conv: Conversation; title: string; other?: Member }) {
  if (conv.type === 'group') return <div className="h-4" />;
  return (
    <div className="px-5 pb-2 pt-8">
      <Avatar src={other?.profile?.avatar_url} name={title} seed={other?.user_id} size={56} />
      <h2 className="mt-3 text-lg font-semibold text-ink">{title}</h2>
      {other?.profile?.description && <p className="mt-1 line-clamp-2 max-w-xl text-sm text-muted">{other.profile.description}</p>}
      <p className="mt-1 text-sm text-muted">
        This is the beginning of your conversation.{' '}
        {other && <Link to={`/u/${other.user_id}`} className="font-medium text-accent hover:underline">View profile</Link>}
      </p>
    </div>
  );
}


/** Shows the chat, or a PIN screen first when the chat is locked. */
export default function ChatPage() {
  const { id = '' } = useParams();
  const { conversations, loaded, isUnlocked, markUnlocked, refresh } = useChats();
  const navigate = useNavigate();
  const [asking, setAsking] = useState(true);
  const [forgot, setForgot] = useState(false);
  const summary = conversations.find((c) => c.id === id);

  useEffect(() => { setAsking(true); }, [id]);

  if (!loaded) return <div className="flex flex-1 items-center justify-center"><Spinner size={24} /></div>;
  if (!summary?.locked || isUnlocked(id)) return <ChatRoom />;

  const title = summary.type === 'group' ? summary.name ?? 'Group' : summary.other_display_name ?? 'Chat';
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-line px-2 md:hidden">
        <IconButton label="Back" onClick={() => navigate('/')}><ArrowLeft size={20} /></IconButton>
      </header>
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          icon={<LockKeyhole size={26} />}
          title={`${title} is locked`}
          body="Enter your chat PIN to open this conversation."
          action={
            <div className="flex flex-col items-center gap-3">
              <Button onClick={() => setAsking(true)}>Enter PIN</Button>
              <button onClick={() => setForgot(true)} className="text-[13px] font-medium text-accent hover:underline">Forgot PIN?</button>
            </div>
          }
        />
      </div>
      <EnterPinDialog
        open={asking}
        onClose={() => setAsking(false)}
        title={`Unlock ${title}`}
        onSubmit={async (pin) => {
          const { data } = await supabase.rpc('verify_chat_pin', { p_pin: pin });
          if (data) markUnlocked(id);
          return Boolean(data);
        }}
      />
      <ForgotPinDialog open={forgot} onClose={() => setForgot(false)} onDone={refresh} />
    </div>
  );
}
