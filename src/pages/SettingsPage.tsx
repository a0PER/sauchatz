import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Bell, Check, ChevronRight, ImagePlus, Lock, Monitor, Moon, Palette, Shield, Sun, User } from 'lucide-react';
import { ACCENTS, BACKGROUND_PRESETS, chatBackgroundCss, readLayout, type Accent, type Density, type Layout, type MessageStyle, type TextSize } from '../lib/layout';
import { ACCEPT_ATTR, mediaPathFromUrl, removeMedia, uploadMedia, validateImage } from '../lib/images';
import { APP_NAME } from '../config';
import { useAuth, useMe } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { statusLabel } from '../lib/format';
import { errorMessage, siteUrl, supabase } from '../lib/supabase';
import { formatAsTyped, formatPhone, normalizePhone } from '../lib/phone';
import type { Profile, Status, Theme } from '../lib/types';
import { Avatar, Button, Field, IconButton, Input, PresenceDot, Spinner, Toggle, cx } from '../components/ui';
import { ConfirmDialog } from '../components/Dialogs';
import { ChatPinCard } from '../components/ChatPin';

type SectionId = 'account' | 'profile' | 'notifications' | 'privacy' | 'appearance';
const SECTIONS: { id: SectionId; label: string; icon: ReactNode }[] = [
  { id: 'account', label: 'Account', icon: <Lock size={18} /> },
  { id: 'profile', label: 'Profile and status', icon: <User size={18} /> },
  { id: 'notifications', label: 'Notifications', icon: <Bell size={18} /> },
  { id: 'privacy', label: 'Privacy and safety', icon: <Shield size={18} /> },
  { id: 'appearance', label: 'Layout and appearance', icon: <Palette size={18} /> },
];

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const active = (SECTIONS.find((s) => s.id === params.get('s'))?.id ?? 'account') as SectionId;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-line px-2 sm:px-6">
        <IconButton label="Back" className="md:hidden" onClick={() => navigate('/')}><ArrowLeft size={20} /></IconButton>
        <h1 className="text-[17px] font-semibold text-ink">Settings</h1>
      </header>
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 py-2 sm:w-60 sm:flex-col sm:border-b-0 sm:border-r sm:px-2 sm:py-3">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setParams({ s: s.id }, { replace: true })}
              className={cx(
                'flex shrink-0 items-center gap-3 rounded-full px-4 py-2 text-left text-sm',
                active === s.id ? 'bg-accent-soft font-semibold text-on-accent-soft' : 'text-ink hover:bg-surface-2',
              )}
            >
              <span className={active === s.id ? '' : 'text-muted'}>{s.icon}</span>
              {s.label}
            </button>
          ))}
        </nav>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <div className="max-w-2xl px-5 py-6 sm:px-10 sm:py-8">
            {active === 'account' && <AccountSection />}
            {active === 'profile' && <ProfileSection />}
            {active === 'notifications' && <NotificationsSection />}
            {active === 'privacy' && <PrivacySection />}
            {active === 'appearance' && <AppearanceSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-6 rounded-2xl border border-line">
      <div className="px-5 pb-1 pt-4">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      <div className="px-5 pb-5 pt-3">{children}</div>
    </section>
  );
}

function Row({ title, description, control }: { title: string; description?: ReactNode; control: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-t border-line py-3.5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-sm text-ink">{title}</div>
        {description && <div className="mt-0.5 text-[13px] text-muted">{description}</div>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function RadioCards<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; description?: string; icon?: ReactNode }[] }) {
  return (
    <div className="grid gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
            value === o.value ? 'border-accent bg-accent-soft/50' : 'border-line hover:bg-surface-2',
          )}
        >
          <span className={cx('flex size-[18px] shrink-0 items-center justify-center rounded-full border-2', value === o.value ? 'border-accent' : 'border-line-strong')}>
            {value === o.value && <span className="size-2 rounded-full bg-accent" />}
          </span>
          {o.icon && <span className="text-muted">{o.icon}</span>}
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink">{o.label}</span>
            {o.description && <span className="block text-[13px] text-muted">{o.description}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ Account ------------------------------ */

function AccountSection() {
  const { email } = useMe();
  const { signOut, settings, updateSettings } = useAuth();
  const toast = useToast();
  const [newEmail, setNewEmail] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [phone, setPhone] = useState(settings?.phone ? formatPhone(settings.phone) : '');
  const [phoneBusy, setPhoneBusy] = useState(false);

  async function changeEmail(e: FormEvent) {
    e.preventDefault();
    setEmailBusy(true);
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() }, { emailRedirectTo: siteUrl() });
    setEmailBusy(false);
    if (error) return toast(errorMessage(error), 'error');
    setNewEmail('');
    toast('Check both inboxes to confirm the change.', 'success');
  }

  async function savePhone(e: FormEvent) {
    e.preventDefault();
    const digits = phone.trim() ? normalizePhone(phone) : null;
    if (phone.trim() && !digits) return toast('That phone number does not look right.', 'error');
    setPhoneBusy(true);
    try {
      await updateSettings({ phone: digits });
      toast(digits ? 'Phone number saved' : 'Phone number removed', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setPhoneBusy(false);
    }
  }
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState('');

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return toast('Use at least 8 characters.', 'error');
    if (password !== password2) return toast('The passwords do not match.', 'error');
    setPwBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setPwBusy(false);
    if (error) return toast(errorMessage(error), 'error');
    setPassword('');
    setPassword2('');
    toast('Password updated', 'success');
  }

  async function deleteAccount() {
    const { error } = await supabase.rpc('delete_my_account');
    if (error) return toast(errorMessage(error), 'error');
    await signOut();
  }

  return (
    <>
      <Card title="Email address" description={<>You sign in with <span className="font-medium text-ink">{email}</span>. It is never shown to other members.</>}>
        <form onSubmit={changeEmail} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label="New email">
              <Input type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} autoComplete="email" />
            </Field>
          </div>
          <Button type="submit" variant="secondary" loading={emailBusy} disabled={!newEmail.trim()}>Change email</Button>
        </form>
      </Card>

      <Card title="Phone number (optional)" description="Private. Only you and the site admin can see it.">
        <form onSubmit={savePhone} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label="Phone">
              <Input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(formatAsTyped(e.target.value))} placeholder="(423) 555-0134" autoComplete="tel" />
            </Field>
          </div>
          <Button type="submit" variant="secondary" loading={phoneBusy}>{phone.trim() ? 'Save' : 'Remove'}</Button>
        </form>
      </Card>

      <Card title="Password">
        <form onSubmit={changePassword} className="space-y-3">
          <Field label="New password" hint="At least 8 characters.">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password">
            <Input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />
          </Field>
          <div className="flex justify-end pt-1">
            <Button type="submit" variant="secondary" loading={pwBusy} disabled={!password}>Update password</Button>
          </div>
        </form>
      </Card>

      <Card title="Session">
        <Row title="Sign out" description={`Sign out of ${APP_NAME} on this device.`} control={<Button variant="secondary" size="sm" onClick={signOut}>Sign out</Button>} />
      </Card>

      <section className="rounded-2xl border border-danger/30 px-5 py-4">
        <h2 className="text-[15px] font-semibold text-danger">Delete account</h2>
        <p className="mt-1 text-[13px] text-muted">
          Permanently deletes your profile, photos and messages. Groups you own are handed to another member. This cannot be undone.
        </p>
        <Button variant="danger" size="sm" className="mt-3" onClick={() => setConfirmDelete(true)}>Delete my account</Button>
      </section>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => { setConfirmDelete(false); setDeleteText(''); }}
        title="Delete your account?"
        confirmLabel="Delete forever"
        danger
        onConfirm={async () => {
          if (deleteText !== 'DELETE') {
            toast('Type DELETE to confirm.', 'error');
            throw new Error('not confirmed');
          }
          await deleteAccount();
        }}
        body={
          <div className="space-y-3">
            <p>Everything will be removed and you will be signed out. Type <span className="font-semibold text-ink">DELETE</span> to confirm.</p>
            <Input value={deleteText} onChange={(e) => setDeleteText(e.target.value)} placeholder="DELETE" />
          </div>
        }
      />
    </>
  );
}

/* ------------------------------ Profile ------------------------------ */

function ProfileSection() {
  const { profile, userId } = useMe();
  const { updateProfile } = useAuth();
  const toast = useToast();

  async function setStatus(s: Status) {
    try { await updateProfile({ status: s }); } catch (e) { toast(errorMessage(e), 'error'); }
  }

  return (
    <>
      <Card title="Your profile" description={profile.is_public ? "Public: everyone on SAUchatz can find you and see your profile." : "Private: only people you chat with can see your photos and details."}>
        <Link to={`/u/${userId}`} className="-mx-2 flex items-center gap-4 rounded-xl px-2 py-2 hover:bg-surface-2">
          <Avatar src={profile.avatar_url} name={profile.display_name} seed={userId} size={52} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink">{profile.display_name}</div>
            <div className="truncate text-[13px] text-muted">{profile.description || 'No description yet'}</div>
          </div>
          <ChevronRight size={18} className="text-muted" />
        </Link>
        <div className="mt-3 flex gap-2">
          <Link to="/profile/edit"><Button size="sm" variant="secondary" tabIndex={-1}>Edit profile</Button></Link>
          <Link to={`/u/${userId}`}><Button size="sm" variant="ghost" tabIndex={-1}>View profile</Button></Link>
        </div>
      </Card>
      <Card title="Status" description="Shown next to your name when you are online.">
        <RadioCards<Status>
          value={profile.status}
          onChange={setStatus}
          options={(['active', 'away', 'dnd'] as Status[]).map((s) => ({
            value: s,
            label: statusLabel(s),
            icon: <PresenceDot presence={s} />,
            description: s === 'active' ? 'Available to chat.' : s === 'away' ? 'Show that you might not reply right away.' : 'Silence all notification sounds and alerts.',
          }))}
        />
      </Card>
    </>
  );
}

/* --------------------------- Notifications --------------------------- */

function NotificationsSection() {
  const { settings, updateSettings } = useAuth();
  const toast = useToast();
  const supported = typeof window !== 'undefined' && 'Notification' in window;
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(supported ? Notification.permission : 'unsupported');
  if (!settings) return <Spinner />;

  async function set(patch: Parameters<typeof updateSettings>[0]) {
    try { await updateSettings(patch); } catch (e) { toast(errorMessage(e), 'error'); }
  }

  async function toggleDesktop(on: boolean) {
    if (on && supported && Notification.permission === 'default') {
      const p = await Notification.requestPermission();
      setPermission(p);
      if (p !== 'granted') return toast('Your browser blocked notifications.', 'error');
    }
    set({ notify_desktop: on });
  }

  return (
    <Card title="Notifications" description="Muted conversations and Do not disturb status never notify you.">
      <Row
        title="Desktop notifications"
        description={
          permission === 'denied'
            ? 'Blocked by your browser. Allow notifications for this site in your browser settings.'
            : permission === 'unsupported'
              ? 'Your browser does not support notifications.'
              : 'Show an alert when a message arrives while this tab is in the background.'
        }
        control={<Toggle checked={settings.notify_desktop && permission === 'granted'} onChange={toggleDesktop} label="Desktop notifications" disabled={permission === 'denied' || permission === 'unsupported'} />}
      />
      <Row
        title="Notification sound"
        description="Play a short sound for new messages."
        control={<Toggle checked={settings.notify_sound} onChange={(v) => set({ notify_sound: v })} label="Notification sound" />}
      />
    </Card>
  );
}

/* ------------------------------ Privacy ------------------------------ */

function PrivacySection() {
  const { profile } = useMe();
  const { updateProfile } = useAuth();
  const toast = useToast();
  const [blocked, setBlocked] = useState<Profile[] | null>(null);
  const [unblockTarget, setUnblockTarget] = useState<Profile | null>(null);

  useEffect(() => {
    supabase
      .from('blocks')
      .select('blocked:profiles!blocks_blocked_id_fkey(*)')
      .order('created_at', { ascending: false })
      .then(({ data }) => setBlocked(((data ?? []) as unknown as { blocked: Profile }[]).map((r) => r.blocked).filter(Boolean)));
  }, []);

  async function set(patch: Partial<Profile>) {
    try { await updateProfile(patch); } catch (e) { toast(errorMessage(e), 'error'); }
  }

  async function unblock(p: Profile) {
    const { error } = await supabase.from('blocks').delete().eq('blocked_id', p.id);
    if (error) return toast(errorMessage(error), 'error');
    setBlocked((list) => list?.filter((x) => x.id !== p.id) ?? null);
    toast(`${p.display_name} is unblocked`);
  }

  return (
    <>
      <p className="mb-6 text-[13px] text-muted">
        <Link to="/privacy" className="font-medium text-accent hover:underline">Privacy and rules</Link>
      </p>
      <Card title="Profile visibility">
        <Row
          title="Public profile"
          description={profile.is_public ? 'Everyone can find you in People and search, and see your photos and details.' : 'Hidden from People and search. Only people you already chat with see your photos and details.'}
          control={<Toggle checked={profile.is_public} onChange={(v) => set({ is_public: v })} label="Public profile" />}
        />
      </Card>
      <Card title="Hearts">
        <Row
          title="Show my heart count"
          description="Show how many hearts you have received in the top right of your profile. When this is off, only you can see the number."
          control={<Toggle checked={profile.show_hearts !== false} onChange={(v) => set({ show_hearts: v })} label="Show my heart count" />}
        />
      </Card>
      <ChatPinCard />
      <Card title="Who can message you" description="People already in a conversation with you can always reply.">
        <RadioCards
          value={profile.allow_messages_from}
          onChange={(v) => set({ allow_messages_from: v })}
          options={[
            { value: 'everyone', label: 'Everyone', description: 'Anyone signed in can start a direct message with you.' },
            { value: 'nobody', label: 'No one new', description: 'Only existing conversations. You can still be added to groups.' },
          ]}
        />
      </Card>
      <Card title="Read receipts">
        <Row
          title="Show read receipts"
          description="Let others see when you have read their messages. If you turn this off, you will not see theirs either."
          control={<Toggle checked={profile.show_read_receipts} onChange={(v) => set({ show_read_receipts: v })} label="Show read receipts" />}
        />
      </Card>
      <Card title="Blocked people" description="Blocked people cannot message you or add you to groups.">
        {blocked === null ? (
          <Spinner />
        ) : blocked.length === 0 ? (
          <p className="text-sm text-muted">You have not blocked anyone.</p>
        ) : (
          <ul className="-mx-2">
            {blocked.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-lg px-2 py-2">
                <Avatar src={p.avatar_url} name={p.display_name} seed={p.id} size={34} />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{p.display_name}</span>
                <Button size="sm" variant="secondary" onClick={() => setUnblockTarget(p)}>Unblock</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ConfirmDialog
        open={Boolean(unblockTarget)}
        onClose={() => setUnblockTarget(null)}
        title={`Unblock ${unblockTarget?.display_name}?`}
        body="They will be able to message you again."
        confirmLabel="Unblock"
        onConfirm={() => (unblockTarget ? unblock(unblockTarget) : undefined)}
      />
    </>
  );
}

/* ---------------------------- Appearance ---------------------------- */

function AppearanceSection() {
  const { settings, updateSettings } = useAuth();
  const toast = useToast();
  if (!settings) return <Spinner />;

  async function set(patch: Parameters<typeof updateSettings>[0]) {
    try { await updateSettings(patch); } catch (e) { toast(errorMessage(e), 'error'); }
  }

  const themes: { value: Theme; label: string; icon: ReactNode }[] = [
    { value: 'system', label: 'Device default', icon: <Monitor size={18} /> },
    { value: 'light', label: 'Light', icon: <Sun size={18} /> },
    { value: 'dark', label: 'Dark', icon: <Moon size={18} /> },
  ];

  const layout = readLayout(settings.layout);
  const setLayout = (patch: Partial<Layout>) => set({ layout: { ...layout, ...patch } });
  const seg = (on: boolean) => cx(
    'flex-1 rounded-lg px-3 py-2 text-sm transition-colors',
    on ? 'bg-surface font-medium text-ink shadow-[0_1px_2px_rgb(0_0_0/0.12)]' : 'text-muted hover:text-ink',
  );

  return (
    <>
      <Card title="Accent color" description="Used for buttons, highlights and your own message bubbles.">
        <div className="flex flex-wrap gap-3">
          {(Object.keys(ACCENTS) as Accent[]).map((a) => {
            const dark = document.documentElement.classList.contains('dark');
            const color = ACCENTS[a][dark ? 'dark' : 'light'].accent;
            return (
              <button
                key={a}
                onClick={() => setLayout({ accent: a })}
                className="flex flex-col items-center gap-1.5 text-xs text-muted"
                aria-label={`${ACCENTS[a].label} accent`}
                aria-pressed={layout.accent === a}
              >
                <span
                  className={cx('flex size-10 items-center justify-center rounded-full ring-offset-2 ring-offset-surface', layout.accent === a && 'ring-2 ring-ink')}
                  style={{ background: color }}
                >
                  {layout.accent === a && <Check size={18} className="text-white mix-blend-difference" />}
                </span>
                {ACCENTS[a].label}
              </button>
            );
          })}
        </div>
      </Card>

      <ChatBackgroundCard layout={layout} setLayout={setLayout} />

      <Card title="Layout">
        <div className="space-y-5">
          <div>
            <div className="mb-2 text-sm text-ink">Text size</div>
            <div className="flex gap-1 rounded-xl bg-surface-2 p-1">
              {([['small', 'Small'], ['default', 'Default'], ['large', 'Large']] as [TextSize, string][]).map(([v, l]) => (
                <button key={v} className={seg(layout.textSize === v)} onClick={() => setLayout({ textSize: v })}>{l}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-sm text-ink">Spacing</div>
            <div className="flex gap-1 rounded-xl bg-surface-2 p-1">
              {([['comfortable', 'Comfortable'], ['compact', 'Compact']] as [Density, string][]).map(([v, l]) => (
                <button key={v} className={seg(layout.density === v)} onClick={() => setLayout({ density: v })}>{l}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-sm text-ink">Message style</div>
            <div className="grid grid-cols-2 gap-2.5">
              {([['classic', 'Classic', 'Names and messages in a list'], ['bubbles', 'Bubbles', 'Your messages on the right']] as [MessageStyle, string, string][]).map(([v, l, d]) => (
                <button
                  key={v}
                  onClick={() => setLayout({ messageStyle: v })}
                  className={cx('rounded-xl border p-3 text-left transition-colors', layout.messageStyle === v ? 'border-accent bg-accent-soft/50' : 'border-line hover:bg-surface-2')}
                >
                  <div className="mb-2.5 space-y-1.5 rounded-lg bg-surface-2 p-2.5">
                    {v === 'classic' ? (
                      <>
                        <div className="flex gap-1.5"><span className="size-3 rounded-full bg-subtle/60" /><span className="h-2 w-16 rounded bg-subtle/50" /></div>
                        <div className="ml-[18px] h-2 w-24 rounded bg-subtle/30" />
                        <div className="flex gap-1.5"><span className="size-3 rounded-full bg-accent/70" /><span className="h-2 w-12 rounded bg-subtle/50" /></div>
                        <div className="ml-[18px] h-2 w-20 rounded bg-subtle/30" />
                      </>
                    ) : (
                      <>
                        <div className="h-3.5 w-20 rounded-full bg-surface-3" />
                        <div className="ml-auto h-3.5 w-16 rounded-full bg-accent/80" />
                        <div className="h-3.5 w-24 rounded-full bg-surface-3" />
                        <div className="ml-auto h-3.5 w-12 rounded-full bg-accent/80" />
                      </>
                    )}
                  </div>
                  <div className="text-sm font-medium text-ink">{l}</div>
                  <div className="text-xs text-muted">{d}</div>
                </button>
              ))}
            </div>
          </div>
          <Row
            title="Message previews"
            description="Show the latest message under each chat in the sidebar."
            control={<Toggle checked={layout.previews} onChange={(v) => setLayout({ previews: v })} label="Message previews" />}
          />
        </div>
      </Card>

      <Card title="Theme">
        <div className="grid grid-cols-3 gap-2.5">
          {themes.map((t) => (
            <button
              key={t.value}
              onClick={() => set({ theme: t.value })}
              className={cx(
                'flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-sm transition-colors',
                settings.theme === t.value ? 'border-accent bg-accent-soft/50 font-medium text-on-accent-soft' : 'border-line text-ink hover:bg-surface-2',
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </Card>
      <Card title="Typing">
        <Row
          title="Press Enter to send"
          description={settings.enter_to_send ? 'Shift + Enter adds a new line.' : 'Ctrl + Enter (or Cmd + Enter) sends. Enter adds a new line.'}
          control={<Toggle checked={settings.enter_to_send} onChange={(v) => set({ enter_to_send: v })} label="Press Enter to send" />}
        />
      </Card>
    </>
  );
}

function ChatBackgroundCard({ layout, setLayout }: { layout: Layout; setLayout: (patch: Partial<Layout>) => void }) {
  const { userId } = useMe();
  const toast = useToast();
  const picker = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const dark = document.documentElement.classList.contains('dark');
  const custom = layout.background.startsWith('https://') ? layout.background : null;

  function choose(bg: string) {
    const old = mediaPathFromUrl(custom);
    if (old && bg !== custom) removeMedia(old);
    setLayout({ background: bg });
  }

  async function upload(f: File | undefined) {
    if (!f) return;
    const problem = validateImage(f);
    if (problem) return toast(problem, 'error');
    setUploading(true);
    try {
      const { url } = await uploadMedia(`users/${userId}/background`, f, 1920);
      choose(url);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setUploading(false);
    }
  }

  const tile = (on: boolean) => cx(
    'relative flex aspect-[4/3] items-end overflow-hidden rounded-xl border-2 p-2 text-left text-xs font-medium transition-colors',
    on ? 'border-accent' : 'border-line hover:border-line-strong',
  );

  return (
    <Card title="Chat background" description="Shown behind your messages. Only you see your background.">
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
        <button onClick={() => choose('none')} className={cx(tile(layout.background === 'none'), 'bg-surface')}>
          <span className="rounded bg-surface/85 px-1.5 py-0.5 text-ink">None</span>
        </button>
        {BACKGROUND_PRESETS.map((p) => (
          <button key={p.id} onClick={() => choose(`preset:${p.id}`)} className={tile(layout.background === `preset:${p.id}`)} style={{ background: dark ? p.dark : p.light }}>
            <span className="rounded bg-surface/85 px-1.5 py-0.5 text-ink">{p.label}</span>
          </button>
        ))}
        {custom && (
          <button onClick={() => choose(custom)} className={tile(true)} style={{ background: chatBackgroundCss(custom, dark) }}>
            <span className="rounded bg-surface/85 px-1.5 py-0.5 text-ink">Your photo</span>
          </button>
        )}
        <button onClick={() => picker.current?.click()} className={cx(tile(false), 'flex-col items-center justify-center gap-1 border-dashed text-muted hover:text-accent')}>
          {uploading ? <Spinner /> : <><ImagePlus size={20} /><span>{custom ? 'Change photo' : 'Upload photo'}</span></>}
        </button>
      </div>
      <input ref={picker} type="file" accept={ACCEPT_ATTR} hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
    </Card>
  );
}
