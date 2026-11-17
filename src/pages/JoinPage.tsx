import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Link2Off, UsersRound } from 'lucide-react';
import { APP_NAME } from '../config';
import { useChats } from '../contexts/ChatContext';
import { useToast } from '../contexts/ToastContext';
import { plural } from '../lib/format';
import { errorMessage, supabase } from '../lib/supabase';
import { Avatar, Button, EmptyState, Logo, Spinner } from '../components/ui';

const PENDING_KEY = 'sauchatz-pending-invite';

export function savePendingInvite(code: string) {
  try { localStorage.setItem(PENDING_KEY, code); } catch { /* ignore */ }
}

export function takePendingInvite(): string | null {
  try {
    const c = localStorage.getItem(PENDING_KEY);
    localStorage.removeItem(PENDING_KEY);
    return c;
  } catch {
    return null;
  }
}

/** Signed out: remember the invite, then send the person to create an account. */
export function JoinSignedOut() {
  const { code = '' } = useParams();
  useEffect(() => { if (code) savePendingInvite(code); }, [code]);
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-[420px] rounded-2xl border border-line bg-surface px-8 py-9 text-center">
        <div className="mb-5 flex justify-center"><Logo size={36} /></div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">You are invited to a group</h1>
        <p className="mt-2 text-sm text-muted">Sign in or create a {APP_NAME} account, and you will join the group right after.</p>
        <div className="mt-6 flex flex-col gap-2.5">
          <Link to="/signup"><Button className="w-full" tabIndex={-1}>Create an account</Button></Link>
          <Link to="/login"><Button variant="secondary" className="w-full" tabIndex={-1}>I already have an account</Button></Link>
        </div>
      </div>
    </div>
  );
}

interface InviteInfo {
  conversation_id: string;
  name: string;
  description: string;
  avatar_url: string | null;
  member_count: number;
  already_member: boolean;
}

export default function JoinPage() {
  const { code = '' } = useParams();
  const { refresh } = useChats();
  const toast = useToast();
  const navigate = useNavigate();
  const [info, setInfo] = useState<InviteInfo | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.rpc('get_invite_info', { p_code: code }).maybeSingle().then(({ data }) => setInfo((data as InviteInfo | null) ?? null));
  }, [code]);

  async function join() {
    setBusy(true);
    const { data, error } = await supabase.rpc('join_group_with_invite', { p_code: code });
    setBusy(false);
    if (error) return toast(errorMessage(error), 'error');
    await refresh();
    toast(`You joined ${info?.name}`, 'success');
    navigate(`/c/${data}`, { replace: true });
  }

  if (info === undefined) return <div className="flex flex-1 items-center justify-center"><Spinner size={24} /></div>;
  if (info === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState icon={<Link2Off size={26} />} title="This invite link does not work" body="It may have been reset by the group admin. Ask them for a new link." action={<Button variant="secondary" onClick={() => navigate('/')}>Go home</Button>} />
      </div>
    );
  }
  if (info.already_member) return <Navigate to={`/c/${info.conversation_id}`} replace />;

  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <div className="flex justify-center"><Avatar src={info.avatar_url} name={info.name} seed={info.conversation_id} size={80} square /></div>
        <p className="mt-5 text-sm text-muted">You are invited to join</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">{info.name}</h1>
        <p className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-muted"><UsersRound size={15} /> {plural(Number(info.member_count), 'member')}</p>
        {info.description && <p className="mt-3 text-sm text-ink">{info.description}</p>}
        <div className="mt-7 flex justify-center gap-2">
          <Button variant="ghost" onClick={() => navigate('/')}>Not now</Button>
          <Button onClick={join} loading={busy}>Join group</Button>
        </div>
      </div>
    </div>
  );
}
