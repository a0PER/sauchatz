import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Flag, KeyRound, Lock, Search, ShieldAlert, ShieldCheck, Trash2, Users } from 'lucide-react';
import { useAuth, useMe } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { formatFullDate, formatListTime } from '../lib/format';
import { formatPhone, loginToPhone } from '../lib/phone';
import { errorMessage, supabase } from '../lib/supabase';
import { Avatar, Button, EmptyState, Field, IconButton, Input, Modal, Spinner, cx } from '../components/ui';
import { ConfirmDialog } from '../components/Dialogs';

interface AdminUser {
  id: string;
  login: string;
  phone: string | null;
  email_confirmed: boolean;
  display_name: string | null;
  avatar_url: string | null;
  is_public: boolean | null;
  created_at: string;
  last_sign_in_at: string | null;
  message_count: number;
  reports_against: number;
  is_admin: boolean;
}

interface AdminReport {
  id: string;
  created_at: string;
  reason: string;
  reporter_id: string | null;
  reporter_name: string | null;
  reported_user_id: string | null;
  reported_name: string | null;
  message_id: string | null;
  message_body: string | null;
  message_image: string | null;
  message_at: string | null;
}

export default function AdminPage() {
  const { isAdmin } = useAuth();
  const { userId } = useMe();
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'users' | 'reports'>('users');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [reports, setReports] = useState<AdminReport[] | null>(null);
  const [term, setTerm] = useState('');
  const [deleting, setDeleting] = useState<AdminUser | { id: string; display_name: string | null } | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);

  const load = useCallback(async () => {
    const [u, r] = await Promise.all([supabase.rpc('admin_list_users'), supabase.rpc('admin_list_reports')]);
    if (u.error) toast(errorMessage(u.error), 'error');
    setUsers(((u.data as AdminUser[]) ?? []).map((x) => ({ ...x, message_count: Number(x.message_count), reports_against: Number(x.reports_against) })));
    setReports((r.data as AdminReport[]) ?? []);
  }, [toast]);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    const digits = t.replace(/\D/g, '');
    if (!users || !t) return users ?? [];
    return users.filter((u) => (u.display_name ?? '').toLowerCase().includes(t) || (digits.length >= 3 && (u.phone ?? '').includes(digits)) || u.login.toLowerCase().includes(t));
  }, [users, term]);

  if (!isAdmin) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState icon={<ShieldAlert size={26} />} title="Admins only" body="You do not have access to this page." action={<Button variant="secondary" onClick={() => navigate('/')}>Go back</Button>} />
      </div>
    );
  }

  async function confirmDelete() {
    if (!deleting) return;
    const { error } = await supabase.rpc('admin_delete_user', { p_user: deleting.id });
    if (error) {
      toast(errorMessage(error), 'error');
      throw error;
    }
    toast(`${deleting.display_name ?? 'Account'} was deleted`, 'success');
    load();
  }

  async function dismiss(r: AdminReport) {
    const { error } = await supabase.rpc('admin_dismiss_report', { p_report: r.id });
    if (error) return toast(errorMessage(error), 'error');
    setReports((list) => list?.filter((x) => x.id !== r.id) ?? null);
  }

  const tabBtn = (id: 'users' | 'reports', label: string, count?: number) => (
    <button
      onClick={() => setTab(id)}
      className={cx('flex items-center gap-2 rounded-full px-4 py-2 text-sm', tab === id ? 'bg-accent-soft font-semibold text-on-accent-soft' : 'text-ink hover:bg-surface-2')}
    >
      {label}
      {count !== undefined && <span className={cx('rounded-full px-1.5 text-xs', tab === id ? 'bg-surface/60' : 'bg-surface-2 text-muted')}>{count}</span>}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-line px-2 sm:px-6">
        <IconButton label="Back" className="md:hidden" onClick={() => navigate('/')}><ArrowLeft size={20} /></IconButton>
        <ShieldCheck size={19} className="text-accent" />
        <h1 className="text-[17px] font-semibold text-ink">Admin</h1>
        <div className="ml-4 flex gap-1">
          {tabBtn('users', 'Accounts', users?.length)}
          {tabBtn('reports', 'Reports', reports?.length)}
        </div>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <p className="mb-4 flex items-start gap-2 rounded-xl bg-surface-2 px-4 py-3 text-[13px] text-muted">
          <Lock size={15} className="mt-0.5 shrink-0" />
          Passwords are stored scrambled and can never be viewed, only replaced. Private conversations are not shown here; reported messages are.
        </p>

        {tab === 'users' && (
          <>
            <div className="relative mb-4 max-w-sm">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
              <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search by name, email or phone" className="h-10 rounded-full pl-9" />
            </div>
            {users === null ? (
              <div className="flex justify-center py-12"><Spinner size={24} /></div>
            ) : filtered.length === 0 ? (
              <EmptyState icon={<Users size={26} />} title="No accounts found" />
            ) : (
              <div className="overflow-hidden rounded-2xl border border-line">
                <table className="w-full text-left text-sm">
                  <thead className="hidden bg-surface-2 text-xs font-medium text-muted md:table-header-group">
                    <tr>
                      <th className="px-4 py-2.5">Member</th>
                      <th className="px-4 py-2.5">Email and phone</th>
                      <th className="px-4 py-2.5">Joined</th>
                      <th className="px-4 py-2.5">Last sign-in</th>
                      <th className="px-4 py-2.5 text-right">Messages</th>
                      <th className="px-4 py-2.5 text-right">Reports</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((u) => (
                      <tr key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-3 first:border-t-0 md:table-row md:p-0">
                        <td className="md:px-4 md:py-3">
                          <Link to={`/u/${u.id}`} className="flex items-center gap-3">
                            <Avatar src={u.avatar_url} name={u.display_name} seed={u.id} size={34} />
                            <span>
                              <span className="block font-medium text-ink">{u.display_name ?? 'No profile'}</span>
                              <span className="flex gap-1.5 text-xs text-muted">
                                {u.is_public === false ? 'Private' : 'Public'}
                                {u.is_admin && <span className="font-semibold text-accent">Admin</span>}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td className="text-[13px] md:px-4 md:py-3">
                          <span className="block text-ink">{loginToPhone(u.login)}</span>
                          <span className="block text-muted">
                            {u.phone ? formatPhone(u.phone) : 'No phone'}
                            {!u.email_confirmed && <span className="ml-2 font-medium text-warning">Not verified</span>}
                          </span>
                        </td>
                        <td className="text-[13px] text-muted md:px-4 md:py-3" title={formatFullDate(u.created_at)}>{formatListTime(u.created_at)}</td>
                        <td className="text-[13px] text-muted md:px-4 md:py-3">{u.last_sign_in_at ? formatListTime(u.last_sign_in_at) : 'Never'}</td>
                        <td className="text-[13px] text-ink md:px-4 md:py-3 md:text-right">{u.message_count}<span className="text-muted md:hidden"> messages</span></td>
                        <td className={cx('text-[13px] md:px-4 md:py-3 md:text-right', u.reports_against > 0 ? 'font-semibold text-danger' : 'text-muted')}>
                          {u.reports_against}<span className="md:hidden"> reports</span>
                        </td>
                        <td className="ml-auto md:px-4 md:py-3">
                          <div className="flex justify-end gap-1">
                            <IconButton label="Set a new password" size={32} onClick={() => setResetting(u)}><KeyRound size={16} /></IconButton>
                            {u.id !== userId && (
                              <IconButton label="Delete account" size={32} className="hover:text-danger" onClick={() => setDeleting(u)}><Trash2 size={16} /></IconButton>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {tab === 'reports' && (
          reports === null ? (
            <div className="flex justify-center py-12"><Spinner size={24} /></div>
          ) : reports.length === 0 ? (
            <EmptyState icon={<Flag size={26} />} title="No open reports" body="When someone reports a person or message, it shows up here." />
          ) : (
            <div className="space-y-3">
              {reports.map((r) => (
                <div key={r.id} className="rounded-2xl border border-line p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px] text-muted">
                    <span>
                      <span className="font-medium text-ink">{r.reporter_name ?? 'Deleted user'}</span> reported{' '}
                      {r.reported_user_id ? <Link to={`/u/${r.reported_user_id}`} className="font-medium text-accent hover:underline">{r.reported_name}</Link> : 'a deleted user'}
                    </span>
                    <span>{formatFullDate(r.created_at)}</span>
                  </div>
                  <p className="mt-2 text-sm text-ink">{r.reason}</p>
                  {r.message_id && (
                    <div className="mt-3 rounded-xl bg-surface-2 px-4 py-3">
                      <div className="mb-1 text-xs font-medium text-muted">Reported message{r.message_at && ` · ${formatFullDate(r.message_at)}`}</div>
                      <p className="whitespace-pre-wrap text-sm text-ink">{r.message_body || (r.message_image ? '[Photo]' : '[Message deleted]')}</p>
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => dismiss(r)}>Dismiss</Button>
                    {r.reported_user_id && r.reported_user_id !== userId && (
                      <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => setDeleting({ id: r.reported_user_id!, display_name: r.reported_name })}>
                        Delete account
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.display_name ?? 'this account'}?`}
        body="Their profile, photos and messages are permanently deleted, and they are removed from every group. This cannot be undone."
        confirmLabel="Delete account"
        danger
        onConfirm={confirmDelete}
      />
      <SetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
    </div>
  );
}

function SetPasswordDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (user) {
      // Suggest a readable temporary password.
      const words = ['river', 'maple', 'cedar', 'harbor', 'summit', 'meadow', 'canyon', 'willow'];
      const w = words[Math.floor(Math.random() * words.length)];
      setPassword(`${w}-${Math.floor(1000 + Math.random() * 9000)}`);
    }
  }, [user]);

  async function save() {
    if (!user) return;
    setBusy(true);
    const { error } = await supabase.rpc('admin_set_password', { p_user: user.id, p_password: password });
    setBusy(false);
    if (error) return toast(errorMessage(error), 'error');
    toast(`New password set for ${user.display_name}. Share it with them privately.`, 'success');
    onClose();
  }

  return (
    <Modal
      open={Boolean(user)}
      onClose={onClose}
      title={`New password for ${user?.display_name ?? ''}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={password.length < 8}>Set password</Button></>}
    >
      <p className="mb-4 text-sm text-muted">
        Use this when someone forgets their password. Give them the new password in person or by text, and ask them to change it in Settings.
      </p>
      <Field label="Temporary password" hint="At least 8 characters.">
        <Input value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" />
      </Field>
    </Modal>
  );
}
