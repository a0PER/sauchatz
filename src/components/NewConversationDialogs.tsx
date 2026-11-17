import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Search, X } from 'lucide-react';
import { MAX_GROUP_DESCRIPTION_LENGTH } from '../config';
import { useMe } from '../contexts/AuthContext';
import { useChats } from '../contexts/ChatContext';
import { usePresence } from '../contexts/PresenceContext';
import { useToast } from '../contexts/ToastContext';
import { errorMessage, supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';
import { Avatar, Button, Field, Input, Modal, Spinner, Textarea, cx } from './ui';

/** Searchable list of everyone, used by every "pick people" dialog. */
function usePeopleSearch(term: string, exclude: string[], includeContacts = false) {
  const [people, setPeople] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const excludeKey = exclude.join(',');
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      let query = supabase.from('profiles').select('*').eq('is_public', true).order('display_name').limit(40);
      const clean = term.trim().replace(/[%_,()]/g, '');
      if (clean) query = query.ilike('display_name', `%${clean}%`);
      if (excludeKey) query = query.not('id', 'in', `(${excludeKey})`);
      const [{ data }, contacts] = await Promise.all([
        query,
        includeContacts ? supabase.rpc('my_private_contacts', { p_term: clean }) : Promise.resolve({ data: [] }),
      ]);
      if (!cancelled) {
        const skip = new Set(excludeKey ? excludeKey.split(',') : []);
        const priv = ((contacts.data as Profile[] | null) ?? []).filter((p) => !skip.has(p.id));
        setPeople([...priv, ...((data as Profile[]) ?? [])]);
        setLoading(false);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term, excludeKey, includeContacts]);
  return { people, loading };
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-10" autoFocus />
    </div>
  );
}

function PersonRow({ p, onClick, selected, disabled }: { p: Profile; onClick: () => void; selected?: boolean; disabled?: boolean }) {
  const { presenceOf } = usePresence();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-surface-2 disabled:opacity-60"
    >
      <Avatar src={p.avatar_url} name={p.display_name} seed={p.id} size={38} presence={presenceOf(p.id, p.status)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 truncate text-sm font-medium text-ink">
          {p.display_name}
          {!p.is_public && <span className="rounded bg-surface-2 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-muted">Private</span>}
        </div>
        <div className="truncate text-xs text-muted">{!p.is_public ? 'Private profile · you have chatted before' : p.description || 'No description yet'}</div>
      </div>
      {selected !== undefined && (
        <span
          className={cx(
            'flex size-5 shrink-0 items-center justify-center rounded-md border',
            selected ? 'border-accent bg-accent text-on-accent' : 'border-line-strong',
          )}
        >
          {selected && <Check size={14} strokeWidth={3} />}
        </span>
      )}
    </button>
  );
}

export function NewChatDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { userId } = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const [term, setTerm] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const { people, loading } = usePeopleSearch(open ? term : '', [userId]);

  useEffect(() => { if (!open) setTerm(''); }, [open]);

  async function start(p: Profile) {
    setBusyId(p.id);
    const { data, error } = await supabase.rpc('get_or_create_direct', { other_user: p.id });
    setBusyId(null);
    if (error) return toast(errorMessage(error), 'error');
    onClose();
    navigate(`/c/${data}`);
  }

  return (
    <Modal open={open} onClose={onClose} title="Message someone">
      <SearchBox value={term} onChange={setTerm} placeholder="Search by name" />
      <div className="-mx-2.5 mt-3 min-h-[280px]">
        {loading && people.length === 0 ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : people.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">No one found.</p>
        ) : (
          people.map((p) => <PersonRow key={p.id} p={p} onClick={() => start(p)} disabled={busyId !== null} />)
        )}
      </div>
    </Modal>
  );
}

export function PeoplePicker({ selected, onChange, exclude }: { selected: Profile[]; onChange: (p: Profile[]) => void; exclude: string[] }) {
  const [term, setTerm] = useState('');
  const { people, loading } = usePeopleSearch(term, exclude, true);
  const ids = new Set(selected.map((p) => p.id));
  const toggle = (p: Profile) => onChange(ids.has(p.id) ? selected.filter((x) => x.id !== p.id) : [...selected, p]);

  return (
    <div>
      {selected.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {selected.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full border border-line-strong py-0.5 pl-0.5 pr-1.5 text-[13px] text-ink">
              <Avatar src={p.avatar_url} name={p.display_name} seed={p.id} size={22} />
              {p.display_name}
              <button type="button" onClick={() => toggle(p)} className="rounded-full p-0.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label={`Remove ${p.display_name}`}>
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
      <SearchBox value={term} onChange={setTerm} placeholder="Add people by name" />
      <div className="-mx-2.5 mt-2 h-[240px] overflow-y-auto scroll-thin">
        {loading && people.length === 0 ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : people.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">No one found.</p>
        ) : (
          people.map((p) => <PersonRow key={p.id} p={p} selected={ids.has(p.id)} onClick={() => toggle(p)} />)
        )}
      </div>
    </div>
  );
}

export function NewGroupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { userId } = useMe();
  const { refresh } = useChats();
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [members, setMembers] = useState<Profile[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setName('');
      setDescription('');
      setMembers([]);
    }
  }, [open]);

  async function create() {
    if (!name.trim()) return toast('Give your group a name.', 'error');
    setBusy(true);
    const { data, error } = await supabase.rpc('create_group', {
      p_name: name.trim(),
      p_description: description.trim(),
      p_member_ids: members.map((m) => m.id),
    });
    setBusy(false);
    if (error) return toast(errorMessage(error), 'error');
    await refresh();
    onClose();
    navigate(`/c/${data}`);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a group"
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={create} loading={busy} disabled={!name.trim()}>Create</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Group name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Design team" />
        </Field>
        <Field label="Description" counter={`${description.length}/${MAX_GROUP_DESCRIPTION_LENGTH}`}>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={MAX_GROUP_DESCRIPTION_LENGTH} placeholder="What is this group about? (optional)" />
        </Field>
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-ink">Members</div>
          <PeoplePicker selected={members} onChange={setMembers} exclude={[userId]} />
        </div>
      </div>
    </Modal>
  );
}

export function AddMembersDialog({ open, onClose, conversationId, existing, onAdded }: {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  existing: string[];
  onAdded: () => void;
}) {
  const toast = useToast();
  const [members, setMembers] = useState<Profile[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) setMembers([]); }, [open]);

  async function add() {
    setBusy(true);
    const { error } = await supabase.rpc('add_group_members', { conv: conversationId, p_member_ids: members.map((m) => m.id) });
    setBusy(false);
    if (error) return toast(errorMessage(error), 'error');
    toast(members.length === 1 ? `${members[0].display_name} was added` : `${members.length} people were added`, 'success');
    onAdded();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add people"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={add} loading={busy} disabled={members.length === 0}>Add</Button>
        </>
      }
    >
      <PeoplePicker selected={members} onChange={setMembers} exclude={existing} />
    </Modal>
  );
}
