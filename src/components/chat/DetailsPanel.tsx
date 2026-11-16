import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Ban, Bell, BellOff, Camera, Flag, LogOut, MoreVertical, Pencil, ShieldCheck, ShieldOff, Trash2, User, UserMinus, UserPlus, X,
} from 'lucide-react';
import { MAX_GROUP_DESCRIPTION_LENGTH } from '../../config';
import { useMe } from '../../contexts/AuthContext';
import { useChats } from '../../contexts/ChatContext';
import { usePresence } from '../../contexts/PresenceContext';
import { useToast } from '../../contexts/ToastContext';
import { formatFullDate, plural, statusLabel } from '../../lib/format';
import { ACCEPT_ATTR, getChatImageUrl, mediaPathFromUrl, removeMedia, uploadMedia, validateImage } from '../../lib/images';
import { errorMessage, supabase } from '../../lib/supabase';
import type { Conversation, Member, Message } from '../../lib/types';
import { Avatar, Button, Field, IconButton, Input, Menu, Modal, Textarea, Toggle, cx } from '../ui';
import { ConfirmDialog, ReportDialog } from '../Dialogs';
import { AddMembersDialog } from '../NewConversationDialogs';

interface Props {
  conv: Conversation;
  members: Member[];
  messages: Message[];
  muted: boolean;
  blockedByMe: boolean;
  onBlockedChange: (b: boolean) => void;
  onClose: () => void;
  onMembersChanged: () => void;
  onOpenImage: (srcs: string[], index: number) => void;
}

function Section({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-line px-5 py-4 last:border-b-0">
      {title && (
        <div className="mb-2.5 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

function ActionRow({ icon, label, onClick, danger }: { icon: ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cx('-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-surface-2', danger ? 'text-danger' : 'text-ink')}
    >
      <span className={danger ? 'text-danger' : 'text-muted'}>{icon}</span>
      {label}
    </button>
  );
}

function SharedPhotos({ messages, onOpen }: { messages: Message[]; onOpen: (srcs: string[], i: number) => void }) {
  const paths = messages.filter((m) => m.image_path && !m.deleted_at).map((m) => m.image_path!).reverse();
  const key = paths.join('|');
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    Promise.all(paths.slice(0, 30).map(getChatImageUrl)).then((list) => alive && setUrls(list.filter(Boolean) as string[]));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (paths.length === 0) return <p className="text-[13px] text-muted">Photos shared in this conversation will appear here.</p>;
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {urls.slice(0, 9).map((u, i) => (
        <button key={u} onClick={() => onOpen(urls, i)} className="aspect-square overflow-hidden rounded-lg bg-surface-2">
          <img src={u} alt="" className="size-full object-cover transition-transform hover:scale-105" loading="lazy" />
        </button>
      ))}
    </div>
  );
}

export function DetailsPanel(props: Props) {
  const { conv, members, messages, muted, onClose, onOpenImage } = props;
  const { userId } = useMe();
  const { setMutedLocally } = useChats();
  const toast = useToast();

  async function setMuted(v: boolean) {
    setMutedLocally(conv.id, v);
    const { error } = await supabase.from('conversation_members').update({ muted: v }).eq('conversation_id', conv.id).eq('user_id', userId);
    if (error) {
      setMutedLocally(conv.id, !v);
      toast(errorMessage(error), 'error');
    }
  }

  return (
    <aside className="animate-in absolute inset-y-0 right-0 z-30 flex w-full max-w-[360px] flex-col border-l border-line bg-surface shadow-panel xl:static xl:w-[340px] xl:shadow-none">
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-line px-5">
        <h2 className="text-[15px] font-semibold text-ink">Details</h2>
        <IconButton label="Close details" onClick={onClose}><X size={19} /></IconButton>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {conv.type === 'direct' ? <DirectDetails {...props} /> : <GroupDetails {...props} />}
        <Section title="Notifications">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm text-ink">
              {muted ? <BellOff size={18} className="text-muted" /> : <Bell size={18} className="text-muted" />}
              Mute this conversation
            </div>
            <Toggle checked={muted} onChange={setMuted} label="Mute this conversation" />
          </div>
          <p className="mt-1.5 pl-[30px] text-xs text-muted">You will not get sounds or alerts, and it will not count toward unread.</p>
        </Section>
        <Section title="Shared photos">
          <SharedPhotos messages={messages} onOpen={onOpenImage} />
        </Section>
        {conv.type === 'group' && <GroupDangerZone conv={conv} members={members} />}
      </div>
    </aside>
  );
}

/* ---------------------------- Direct message ---------------------------- */

function DirectDetails({ members, blockedByMe, onBlockedChange }: Props) {
  const { userId } = useMe();
  const { presenceOf } = usePresence();
  const toast = useToast();
  const [reporting, setReporting] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const other = members.find((m) => m.user_id !== userId);
  const p = other?.profile;

  if (!other || !p) {
    return <Section><p className="text-sm text-muted">This person deleted their account.</p></Section>;
  }

  async function block() {
    const { error } = await supabase.from('blocks').insert({ blocker_id: userId, blocked_id: other!.user_id });
    if (error) return toast(errorMessage(error), 'error');
    onBlockedChange(true);
    toast(`${p!.display_name} is blocked`);
  }
  async function unblock() {
    const { error } = await supabase.from('blocks').delete().eq('blocked_id', other!.user_id);
    if (error) return toast(errorMessage(error), 'error');
    onBlockedChange(false);
  }

  const presence = presenceOf(p.id, p.status);
  return (
    <>
      <Section>
        <div className="flex flex-col items-center pt-2 text-center">
          <Avatar src={p.avatar_url} name={p.display_name} seed={p.id} size={80} presence={presence} />
          <h3 className="mt-3 text-base font-semibold text-ink">{p.display_name}</h3>
          <p className="text-xs text-muted">{statusLabel(presence)}</p>
          {p.description && <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-[13px] text-muted">{p.description}</p>}
          <Link to={`/u/${p.id}`} className="mt-4 inline-flex">
            <Button size="sm" variant="tonal" tabIndex={-1}>View profile</Button>
          </Link>
        </div>
      </Section>
      <Section title="Privacy and safety">
        {blockedByMe ? (
          <ActionRow icon={<Ban size={18} />} label={`Unblock ${p.display_name}`} onClick={unblock} />
        ) : (
          <ActionRow icon={<Ban size={18} />} label={`Block ${p.display_name}`} onClick={() => setConfirmBlock(true)} danger />
        )}
        <ActionRow icon={<Flag size={18} />} label="Report" onClick={() => setReporting(true)} danger />
      </Section>
      <ConfirmDialog
        open={confirmBlock}
        onClose={() => setConfirmBlock(false)}
        title={`Block ${p.display_name}?`}
        body="They will not be able to message you or add you to groups. They will not be told that you blocked them."
        confirmLabel="Block"
        danger
        onConfirm={block}
      />
      <ReportDialog open={reporting} onClose={() => setReporting(false)} userId={p.id} userName={p.display_name} />
    </>
  );
}

/* -------------------------------- Groups -------------------------------- */

const roleOrder = { owner: 0, admin: 1, member: 2 } as const;

function GroupDetails({ conv, members, onMembersChanged }: Props) {
  const { userId } = useMe();
  const { presenceOf } = usePresence();
  const toast = useToast();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const myRole = members.find((m) => m.user_id === userId)?.role ?? 'member';
  const isAdmin = myRole === 'owner' || myRole === 'admin';
  const sorted = [...members].sort(
    (a, b) => roleOrder[a.role] - roleOrder[b.role] || (a.profile?.display_name ?? '').localeCompare(b.profile?.display_name ?? ''),
  );

  async function rpc(fn: string, args: Record<string, unknown>, success: string) {
    const { error } = await supabase.rpc(fn, args);
    if (error) return toast(errorMessage(error), 'error');
    toast(success);
    onMembersChanged();
  }

  return (
    <>
      <Section>
        <div className="flex flex-col items-center pt-2 text-center">
          <Avatar src={conv.avatar_url} name={conv.name} seed={conv.id} size={80} square />
          <h3 className="mt-3 text-base font-semibold text-ink">{conv.name}</h3>
          <p className="text-xs text-muted">Group · Created {formatFullDate(conv.created_at)}</p>
          {conv.description && <p className="mt-3 whitespace-pre-wrap text-[13px] text-muted">{conv.description}</p>}
          {isAdmin && (
            <Button size="sm" variant="tonal" className="mt-4" icon={<Pencil size={14} />} onClick={() => setEditing(true)}>
              Edit group
            </Button>
          )}
        </div>
      </Section>
      <Section
        title={plural(members.length, 'member')}
        action={isAdmin && <Button size="sm" variant="ghost" icon={<UserPlus size={15} />} onClick={() => setAdding(true)}>Add</Button>}
      >
        <ul className="-mx-2">
          {sorted.map((m) => {
            const p = m.profile;
            const name = p?.display_name ?? 'Deleted user';
            const canManage = isAdmin && m.user_id !== userId && m.role !== 'owner' && (myRole === 'owner' || m.role === 'member');
            return (
              <li key={m.user_id} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2">
                <Link to={`/u/${m.user_id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar src={p?.avatar_url} name={name} seed={m.user_id} size={34} presence={presenceOf(m.user_id, p?.status)} />
                  <div className="min-w-0">
                    <div className="truncate text-sm text-ink">{name}{m.user_id === userId && <span className="text-muted"> (you)</span>}</div>
                    {m.role !== 'member' && <div className="text-xs text-muted">{m.role === 'owner' ? 'Owner' : 'Admin'}</div>}
                  </div>
                </Link>
                {canManage && (
                  <Menu
                    trigger={(t) => (
                      <IconButton {...t} label={`Manage ${name}`} size={30} className="opacity-0 group-hover:opacity-100 aria-expanded:opacity-100 focus:opacity-100">
                        <MoreVertical size={16} />
                      </IconButton>
                    )}
                    items={[
                      ...(myRole === 'owner'
                        ? [m.role === 'admin'
                            ? { label: 'Remove as admin', icon: <ShieldOff size={16} />, onSelect: () => rpc('set_member_role', { conv: conv.id, p_user: m.user_id, p_role: 'member' }, `${name} is no longer an admin`) }
                            : { label: 'Make admin', icon: <ShieldCheck size={16} />, onSelect: () => rpc('set_member_role', { conv: conv.id, p_user: m.user_id, p_role: 'admin' }, `${name} is now an admin`) }]
                        : []),
                      { label: 'View profile', icon: <User size={16} />, onSelect: () => navigate(`/u/${m.user_id}`) },
                      { label: 'Remove from group', icon: <UserMinus size={16} />, danger: true, divider: true, onSelect: () => rpc('remove_group_member', { conv: conv.id, p_user: m.user_id }, `${name} was removed`) },
                    ]}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </Section>
      <EditGroupDialog open={editing} onClose={() => setEditing(false)} conv={conv} />
      <AddMembersDialog
        open={adding}
        onClose={() => setAdding(false)}
        conversationId={conv.id}
        existing={members.map((m) => m.user_id)}
        onAdded={onMembersChanged}
      />
    </>
  );
}

function GroupDangerZone({ conv, members }: { conv: Conversation; members: Member[] }) {
  const { userId } = useMe();
  const { refresh } = useChats();
  const navigate = useNavigate();
  const toast = useToast();
  const [confirm, setConfirm] = useState<'leave' | 'delete' | null>(null);
  const isOwner = members.find((m) => m.user_id === userId)?.role === 'owner';

  async function run(fn: 'leave_group' | 'delete_group') {
    const { error } = await supabase.rpc(fn, { conv: conv.id });
    if (error) return toast(errorMessage(error), 'error');
    toast(fn === 'leave_group' ? `You left ${conv.name}` : `${conv.name} was deleted`);
    await refresh();
    navigate('/', { replace: true });
  }

  return (
    <Section>
      <ActionRow icon={<LogOut size={18} />} label="Leave group" onClick={() => setConfirm('leave')} danger />
      {isOwner && <ActionRow icon={<Trash2 size={18} />} label="Delete group" onClick={() => setConfirm('delete')} danger />}
      <ConfirmDialog
        open={confirm === 'leave'}
        onClose={() => setConfirm(null)}
        title={`Leave ${conv.name}?`}
        body={isOwner && members.length > 1 ? 'You are the owner. Ownership will pass to an admin, or to the longest standing member.' : 'You will stop receiving messages from this group.'}
        confirmLabel="Leave"
        danger
        onConfirm={() => run('leave_group')}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        title={`Delete ${conv.name}?`}
        body="The group and all of its messages will be permanently deleted for everyone. This cannot be undone."
        confirmLabel="Delete group"
        danger
        onConfirm={() => run('delete_group')}
      />
    </Section>
  );
}

function EditGroupDialog({ open, onClose, conv }: { open: boolean; onClose: () => void; conv: Conversation }) {
  const toast = useToast();
  const { refresh } = useChats();
  const [name, setName] = useState(conv.name ?? '');
  const [description, setDescription] = useState(conv.description);
  const [avatar, setAvatar] = useState<string | null>(conv.avatar_url);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(conv.name ?? '');
      setDescription(conv.description);
      setAvatar(conv.avatar_url);
      setFile(null);
    }
  }, [open, conv]);

  async function save() {
    if (!name.trim()) return toast('The group needs a name.', 'error');
    setBusy(true);
    try {
      let avatar_url = avatar;
      if (file) avatar_url = (await uploadMedia(`groups/${conv.id}`, file, 512)).url;
      const { error } = await supabase.from('conversations').update({ name: name.trim(), description: description.trim(), avatar_url }).eq('id', conv.id);
      if (error) throw error;
      const oldPath = mediaPathFromUrl(conv.avatar_url);
      if (oldPath && avatar_url !== conv.avatar_url) removeMedia(oldPath);
      await refresh();
      toast('Group updated', 'success');
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  const filePreview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (filePreview) URL.revokeObjectURL(filePreview); }, [filePreview]);
  const preview = filePreview ?? avatar;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit group"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}
    >
      <div className="mb-5 flex items-center gap-4">
        <Avatar src={preview} name={name || conv.name} seed={conv.id} size={72} square />
        <div className="flex flex-col items-start gap-1.5">
          <Button size="sm" variant="secondary" icon={<Camera size={15} />} onClick={() => picker.current?.click()}>Change picture</Button>
          {(avatar || file) && (
            <button className="text-xs font-medium text-danger hover:underline" onClick={() => { setAvatar(null); setFile(null); }}>Remove picture</button>
          )}
        </div>
        <input
          ref={picker}
          type="file"
          accept={ACCEPT_ATTR}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            const problem = validateImage(f);
            if (problem) return toast(problem, 'error');
            setFile(f);
          }}
        />
      </div>
      <div className="space-y-4">
        <Field label="Group name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Description" counter={`${description.length}/${MAX_GROUP_DESCRIPTION_LENGTH}`}>
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={MAX_GROUP_DESCRIPTION_LENGTH} />
        </Field>
      </div>
    </Modal>
  );
}
