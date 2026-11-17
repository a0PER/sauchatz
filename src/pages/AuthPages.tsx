import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, MailCheck, ShieldCheck } from 'lucide-react';
import { APP_NAME } from '../config';
import { errorMessage, siteUrl, supabase } from '../lib/supabase';
import { formatAsTyped, normalizePhone } from '../lib/phone';
import { useAuth } from '../contexts/AuthContext';
import { Button, Field, Input, Logo } from '../components/ui';

function TrustNotes() {
  return (
    <div className="mt-7 space-y-2.5 border-t border-line pt-5 text-[13px] text-muted">
      <p className="flex gap-2.5">
        <Lock size={16} className="mt-0.5 shrink-0 text-success" />
        <span><span className="font-medium text-ink">Your conversations are private.</span> Only the people in a chat can read it, and you can lock any chat with a PIN.</span>
      </p>
      <p className="flex gap-2.5">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-success" />
        <span><span className="font-medium text-ink">Your email and phone number are never shown</span> to other members. Everything is sent over a secure, encrypted connection.</span>
      </p>
    </div>
  );
}

function AuthCard({ title, subtitle, children, footer, notes = true }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; notes?: boolean }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-[420px] rounded-2xl border border-line bg-surface px-8 pb-7 pt-9 shadow-[0_1px_2px_rgb(16_24_40/0.04)] sm:px-10">
        <div className="mb-7 flex items-center gap-2.5">
          <Logo size={30} />
          <span className="text-[17px] font-semibold tracking-tight text-ink">{APP_NAME}</span>
          <span className="ml-auto rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-semibold text-on-accent-soft">For SAU students</span>
        </div>
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
        <div className="mt-7">{children}</div>
        {notes && <TrustNotes />}
      </div>
      {footer && <div className="mt-6 text-sm text-muted">{footer}</div>}
      <p className="mt-6 max-w-[420px] text-center text-xs leading-relaxed text-subtle">
        {APP_NAME} is an independent student project made for current Southern Adventist University students.
        It is not affiliated with, endorsed by, or run by Southern Adventist University.
      </p>
    </div>
  );
}

function PasswordInput(props: { value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? 'text' : 'password'}
        required
        minLength={8}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete={props.autoComplete}
        className="pr-11"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-subtle hover:bg-surface-2 hover:text-ink"
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}

function ErrorBox({ text }: { text: string }) {
  return <div className="mb-4 rounded-lg bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">{text}</div>;
}

function CheckInbox({ email, what }: { email: string; what: string }) {
  return (
    <div className="flex flex-col items-start">
      <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-accent-soft text-on-accent-soft">
        <MailCheck size={24} />
      </div>
      <p className="text-sm text-ink">
        We sent a link to <span className="font-medium">{email}</span>. Open it to {what}.
      </p>
      <p className="mt-2 text-[13px] text-muted">If you do not see it within a few minutes, check your spam folder.</p>
      <Link to="/login" className="mt-6 text-sm font-medium text-accent hover:underline">Back to sign in</Link>
    </div>
  );
}

export function SignInPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setError(/invalid login/i.test(error.message) ? 'That email and password do not match.' : /not confirmed/i.test(error.message) ? 'Please verify your email first. Check your inbox for the link.' : errorMessage(error));
    }
  }

  return (
    <AuthCard
      title="Sign in"
      subtitle={`Continue to ${APP_NAME}`}
      footer={<>New here? <Link to="/signup" className="font-medium text-accent hover:underline">Create an account</Link></>}
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBox text={error} />}
        <Field label="Email">
          <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <Field label="Password">
          <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" />
        </Field>
        <div className="flex items-center justify-between pt-3">
          <Link to="/forgot" className="text-sm font-medium text-accent hover:underline">Forgot password?</Link>
          <Button type="submit" loading={busy}>Sign in</Button>
        </div>
      </form>
    </AuthCard>
  );
}

export function SignUpPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Please enter your name.');
    const digits = phone.trim() ? normalizePhone(phone) : null;
    if (phone.trim() && !digits) return setError('That phone number does not look right. You can also leave it empty.');
    if (password.length < 8) return setError('Use at least 8 characters for your password.');
    if (!agree) return setError('Please confirm you are a current SAU student and 18 or older.');
    setBusy(true);
    setError('');
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: siteUrl(), data: { display_name: name.trim(), ...(digits ? { phone: digits } : {}) } },
    });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    if (!data.session) setSent(true);
  }

  if (sent) {
    return (
      <AuthCard title="Verify your email" notes={false}>
        <CheckInbox email={email} what="verify your email and finish creating your account" />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Your email and phone stay private. People only see your profile."
      footer={<>Already have an account? <Link to="/login" className="font-medium text-accent hover:underline">Sign in</Link></>}
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBox text={error} />}
        <Field label="Your name" hint="This is what everyone sees.">
          <Input required maxLength={60} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Email" hint="We will send a link to verify it.">
          <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Phone number (optional)" hint="Kept private. Only you and the site admin can see it.">
          <Input type="tel" inputMode="tel" autoComplete="tel" placeholder="(423) 555-0134" value={phone} onChange={(e) => setPhone(formatAsTyped(e.target.value))} />
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" />
        </Field>
        <label className="flex cursor-pointer items-start gap-2.5 pt-1 text-[13px] text-ink">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
          I am a current Southern Adventist University student and I am 18 or older.
        </label>
        <div className="flex justify-end pt-2">
          <Button type="submit" loading={busy}>Create account</Button>
        </div>
      </form>
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: siteUrl() });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    setSent(true);
  }

  if (sent) {
    return (
      <AuthCard title="Check your email" notes={false}>
        <CheckInbox email={email} what="choose a new password" />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Reset your password" subtitle="Enter your email and we will send you a link to reset it." notes={false}>
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBox text={error} />}
        <Field label="Email">
          <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <div className="flex items-center justify-between pt-3">
          <Link to="/login" className="text-sm font-medium text-accent hover:underline">Back to sign in</Link>
          <Button type="submit" loading={busy}>Send link</Button>
        </div>
      </form>
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const { clearRecovery } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError('Use at least 8 characters for your password.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    clearRecovery();
    navigate('/', { replace: true });
  }

  return (
    <AuthCard title="Choose a new password" notes={false}>
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBox text={error} />}
        <Field label="New password" hint="At least 8 characters.">
          <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" />
        </Field>
        <div className="flex justify-end pt-3">
          <Button type="submit" loading={busy}>Save password</Button>
        </div>
      </form>
    </AuthCard>
  );
}

export function SetupNeeded() {
  return (
    <AuthCard title="Connect your database" subtitle="This site is not connected to Supabase yet." notes={false}>
      <p className="text-sm text-ink">Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the hosting settings, then redeploy. See README.md.</p>
    </AuthCard>
  );
}
