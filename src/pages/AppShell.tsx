import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom';
import {
  BellOff, ChevronDown, Image as ImageIcon, LogOut, MessageSquarePlus, Plus, Search, Settings, SquarePen,
  User, Users, UsersRound, X,
} from 'lucide-react';
import { APP_NAME } from '../config';
import { useAuth, useMe } from '../contexts/AuthContext';
import { useChats } from '../contexts/ChatContext';
import { usePresence } from '../contexts/PresenceContext';
import { useToast } from '../contexts/ToastContext';
import { formatListTime, statusLabel } from '../lib/format';
import { errorMessage, supabase } from '../lib/supabase';
import type { ConversationSummary, Profile, Status } from '../lib/types';
import { Avatar, IconButton, Logo, Menu, PresenceDot, SectionLabel, cx } from '../components/ui';
import { NewChatDialog, NewGroupDialog } from '../components/NewConversationDialogs';

interface ShellApi {
  openNewChat: () => void;
  openNewGroup: () => void;
}
const ShellContext = createContext<ShellApi>({ openNewChat: () => {}, openNewGroup: () => {} });
export const useShell = () => useContext(ShellContext);

export function conversationTitle(c: Pick<ConversationSummary, 'type' | 'name' | 'other_display_name'>) {
  return c.type === 'group' ? c.name ?? 'Group' : c.other_display_name ?? 'Deleted user';
}

export default function AppShell() {
  const [dialog, setDialog] = useState<'chat' | 'group' | null>(null);
  const atHome = useMatch('/');
  const api = useMemo(() => ({ openNewChat: () => setDialog('chat'), openNewGroup: () => setDialog('group') }), []);

  return (
    <ShellContext.Provider value={api}>
      <div className="flex h-full flex-col">
        <TopBar />
        <div className="flex min-h-0 flex-1 md:pb-3 md:pr-3">
          <aside className={cx('min-h-0 w-full shrink-0 flex-col md:flex md:w-[300px]', atHome ? 'flex' : 'hidden')}>
            <Sidebar />
          </aside>
          <main
            className={cx(
              'min-w-0 flex-1 flex-col overflow-hidden bg-surface md:flex md:rounded-2xl md:border md:border-line',
              atHome ? 'hidden' : 'flex',
            )}
          >
            <Outlet />
          </main>
        </div>
      </div>
      <NewChatDialog open={dialog === 'chat'} onClose={() => setDialog(null)} />
      <NewGroupDialog open={dialog === 'group'} onClose={() => setDialog(null)} />
    </ShellContext.Provider>
  );
}

/* ------------------------------ Top bar ------------------------------ */

const STATUSES: Status[] = ['active', 'away', 'dnd'];

function TopBar() {
  const { profile, email, userId } = useMe();
  const { updateProfile, signOut } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  async function setStatus(s: Status) {
    try {
      await updateProfile({ status: s });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 px-3 md:px-4">
      <Link to="/" className="flex shrink-0 items-center gap-2.5 rounded-lg pr-2 md:w-[284px]">
        <Logo size={30} />
        <span className="hidden text-[19px] font-semibold tracking-tight text-ink sm:inline">{APP_NAME}</span>
      </Link>
      <div className="flex min-w-0 flex-1 justify-center md:justify-start">
        <GlobalSearch />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Menu
          trigger={(p) => (
            <button
              {...p}
              className="hidden h-9 items-center gap-2 rounded-full border border-line-strong px-3 text-[13px] font-medium text-ink hover:bg-surface-2 sm:inline-flex"
            >
              <PresenceDot presence={profile.status} />
              {statusLabel(profile.status)}
              <ChevronDown size={15} className="text-muted" />
            </button>
          )}
          items={STATUSES.map((s) => ({
            label: statusLabel(s),
            icon: <PresenceDot presence={s} />,
            checked: profile.status === s,
            onSelect: () => setStatus(s),
          }))}
        />
        <IconButton label="Settings" size={40} onClick={() => navigate('/settings')}>
          <Settings size={20} />
        </IconButton>
        <Menu
          trigger={(p) => (
            <button {...p} className="ml-1 rounded-full p-1 hover:bg-surface-2" aria-label="Account menu">
              <Avatar src={profile.avatar_url} name={profile.display_name} seed={userId} size={32} />
            </button>
          )}
          header={
            <div className="flex items-center gap-3 border-b border-line px-4 pb-3 pt-2">
              <Avatar src={profile.avatar_url} name={profile.display_name} seed={userId} size={40} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink">{profile.display_name}</div>
                <div className="truncate text-xs text-muted">{email}</div>
              </div>
            </div>
          }
          items={[
            { label: 'View profile', icon: <User size={17} />, onSelect: () => navigate(`/u/${userId}`) },
            ...STATUSES.map((s, i) => ({
              label: statusLabel(s),
              icon: <PresenceDot presence={s} />,
              checked: profile.status === s,
              divider: i === 0,
              onSelect: () => setStatus(s),
            })),
            { label: 'Settings', icon: <Settings size={17} />, divider: true, onSelect: () => navigate('/settings') },
            { label: 'Sign out', icon: <LogOut size={17} />, onSelect: () => signOut() },
          ]}
        />
      </div>
    </header>
  );
}

/* ------------------------------ Search ------------------------------ */

function GlobalSearch() {
  const { conversations } = useChats();
  const { userId } = useMe();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<Profile[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const term = q.trim().toLowerCase();

  useEffect(() => {
    if (!term) return setPeople([]);
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .ilike('display_name', `%${term.replace(/[%_]/g, '')}%`)
        .neq('id', userId)
        .order('display_name')
        .limit(6);
      setPeople((data as Profile[]) ?? []);
    }, 180);
    return () => clearTimeout(t);
  }, [term, userId]);

  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const groups = term ? conversations.filter((c) => c.type === 'group' && conversationTitle(c).toLowerCase().includes(term)).slice(0, 5) : [];

  function go(path: string) {
    setOpen(false);
    setQ('');
    input.current?.blur();
    navigate(path);
  }

  return (
    <div ref={box} className="relative w-full max-w-[680px]">
      <div className="flex h-11 items-center gap-2 rounded-full bg-surface-3/70 px-4 focus-within:bg-surface focus-within:shadow-panel dark:bg-surface-2">
        <Search size={18} className="shrink-0 text-muted" />
        <input
          ref={input}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
            if (e.key === 'Enter') {
              if (people[0]) go(`/u/${people[0].id}`);
              else if (groups[0]) go(`/c/${groups[0].id}`);
            }
          }}
          placeholder="Search people and groups"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted"
        />
        {q && (
          <button onClick={() => setQ('')} className="rounded-full p-1 text-muted hover:text-ink" aria-label="Clear search">
            <X size={16} />
          </button>
        )}
      </div>
      {open && term && (
        <div className="animate-in absolute inset-x-0 top-full z-40 mt-1.5 overflow-hidden rounded-2xl border border-line bg-surface py-2 shadow-panel">
          {people.length === 0 && groups.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted">No results for "{q.trim()}"</div>
          )}
          {people.length > 0 && <div className="px-4 pb-1 pt-1 text-xs font-medium text-subtle">People</div>}
          {people.map((p) => (
            <button key={p.id} onClick={() => go(`/u/${p.id}`)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-2">
              <Avatar src={p.avatar_url} name={p.display_name} seed={p.id} size={32} />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ink">{p.display_name}</div>
                {p.description && <div className="truncate text-xs text-muted">{p.description}</div>}
              </div>
            </button>
          ))}
          {groups.length > 0 && <div className="px-4 pb-1 pt-2 text-xs font-medium text-subtle">Groups</div>}
          {groups.map((c) => (
            <button key={c.id} onClick={() => go(`/c/${c.id}`)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-2">
              <Avatar src={c.avatar_url} name={c.name} seed={c.id} size={32} square />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ink">{c.name}</div>
                <div className="truncate text-xs text-muted">{c.member_count} members</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Sidebar ------------------------------ */

function Sidebar() {
  const { conversations, loaded } = useChats();
  const { openNewChat, openNewGroup } = useShell();
  const navigate = useNavigate();
  const dms = conversations.filter((c) => c.type === 'direct');
  const groups = conversations.filter((c) => c.type === 'group');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-2 pt-1">
        <Menu
          align="left"
          trigger={(p) => (
            <button
              {...p}
              className="inline-flex h-14 items-center gap-3 rounded-2xl bg-surface pl-4 pr-6 text-sm font-medium text-ink shadow-[0_1px_3px_rgb(16_24_40/0.12)] transition-shadow hover:shadow-panel dark:bg-surface-2"
            >
              <SquarePen size={20} className="text-accent" />
              New chat
            </button>
          )}
          items={[
            { label: 'Message someone', icon: <MessageSquarePlus size={17} />, onSelect: openNewChat },
            { label: 'Create a group', icon: <UsersRound size={17} />, onSelect: openNewGroup },
            { label: 'Browse people', icon: <Users size={17} />, onSelect: () => navigate('/people') },
          ]}
        />
      </div>

      <nav className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-4">
        <NavLink
          to="/people"
          className={({ isActive }) =>
            cx(
              'mx-2 mt-1 flex h-10 items-center gap-3 rounded-full px-4 text-sm',
              isActive ? 'bg-accent-soft font-semibold text-on-accent-soft' : 'text-ink hover:bg-surface-3/60',
            )
          }
        >
          <Users size={18} />
          People
        </NavLink>

        <SectionLabel action={<IconButton label="Message someone" size={28} onClick={openNewChat}><Plus size={17} /></IconButton>}>
          Direct messages
        </SectionLabel>
        {loaded && dms.length === 0 && (
          <button onClick={openNewChat} className="mx-4 my-1 text-left text-[13px] text-muted hover:text-accent">
            Start a conversation with anyone.
          </button>
        )}
        {dms.map((c) => <ConversationItem key={c.id} c={c} />)}

        <SectionLabel action={<IconButton label="Create a group" size={28} onClick={openNewGroup}><Plus size={17} /></IconButton>}>
          Groups
        </SectionLabel>
        {loaded && groups.length === 0 && (
          <button onClick={openNewGroup} className="mx-4 my-1 text-left text-[13px] text-muted hover:text-accent">
            Create a group to chat with several people.
          </button>
        )}
        {groups.map((c) => <ConversationItem key={c.id} c={c} />)}
      </nav>
    </div>
  );
}

function ConversationItem({ c }: { c: ConversationSummary }) {
  const { userId } = useMe();
  const { presenceOf } = usePresence();
  const location = useLocation();
  const active = location.pathname === `/c/${c.id}`;
  const unread = c.unread_count > 0;
  const title = conversationTitle(c);

  let preview: ReactNode = c.type === 'group' ? `${c.member_count} members` : 'Say hello';
  if (c.last_sender_id || c.last_body !== null) {
    const who = c.last_sender_id === userId ? 'You' : c.type === 'group' ? c.last_sender_name?.split(' ')[0] : null;
    const body = c.last_deleted ? 'Message deleted' : c.last_body || (c.last_has_image ? 'Photo' : '');
    preview = (
      <>
        {who && <span>{who}: </span>}
        {c.last_has_image && !c.last_deleted && <ImageIcon size={13} className="mr-1 inline -translate-y-px" />}
        {body}
      </>
    );
  }

  return (
    <Link
      to={`/c/${c.id}`}
      className={cx(
        'mx-2 flex items-center gap-3 rounded-full py-1.5 pl-3 pr-4',
        active ? 'bg-accent-soft' : 'hover:bg-surface-3/60',
      )}
    >
      {c.type === 'direct' ? (
        <Avatar src={c.other_avatar_url} name={c.other_display_name} seed={c.other_user_id ?? c.id} size={34} presence={c.other_user_id ? presenceOf(c.other_user_id, c.other_status) : undefined} />
      ) : (
        <Avatar src={c.avatar_url} name={c.name} seed={c.id} size={34} square />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cx('flex-1 truncate text-sm', unread ? 'font-semibold text-ink' : 'text-ink', active && 'text-on-accent-soft')}>
            {title}
          </span>
          <span className={cx('shrink-0 text-[11px]', unread ? 'font-semibold text-accent' : 'text-subtle')}>
            {formatListTime(c.last_message_at)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={cx('flex-1 truncate text-[13px]', unread ? 'font-medium text-ink' : 'text-muted')}>{preview}</span>
          {c.muted && <BellOff size={13} className="shrink-0 text-subtle" />}
          {unread && !c.muted && (
            <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-on-accent">
              {c.unread_count > 99 ? '99+' : c.unread_count}
            </span>
          )}
          {unread && c.muted && <span className="size-2 shrink-0 rounded-full bg-subtle" />}
        </div>
      </div>
    </Link>
  );
}
