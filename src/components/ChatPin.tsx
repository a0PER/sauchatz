import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Lock, LockKeyhole } from 'lucide-react';
import { useMe } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { errorMessage, supabase } from '../lib/supabase';
import { Button, Field, Input, Modal, cx } from './ui';

export function usePinStatus() {
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const { data } = await supabase.rpc('pin_status');
    const row = (data as { has_pin: boolean; locked_until: string | null }[] | null)?.[0];
    setHasPin(Boolean(row?.has_pin));
    setLockedUntil(row?.locked_until ?? null);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { hasPin, lockedUntil, refresh };
}

/** A row of large dots that fills as digits are typed. */
export function PinInput({ value, onChange, autoFocus, length = 6 }: { value: string; onChange: (v: string) => void; autoFocus?: boolean; length?: number }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocus) setTimeout(() => ref.current?.focus(), 50); }, [autoFocus]);
  return (
    <div className="relative" onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, length))}
        inputMode="numeric"
        autoComplete="off"
        aria-label="PIN"
        className="absolute inset-0 opacity-0"
      />
      <div className="flex justify-center gap-3 py-2">
        {Array.from({ length }).map((_, i) => (
          <span
            key={i}
            className={cx(
              'size-3.5 rounded-full border-2 transition-colors',
              i < value.length ? 'border-accent bg-accent' : i < 4 ? 'border-line-strong' : 'border-dashed border-line',
            )}
          />
        ))}
      </div>
    </div>
  );
}

/** Asks for the PIN. onSubmit returns true when the PIN was right. */
export function EnterPinDialog({ open, onClose, title, onSubmit }: {
  open: boolean;
  onClose: () => void;
  title: string;
  onSubmit: (pin: string) => Promise<boolean>;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) { setPin(''); setError(''); } }, [open]);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (pin.length < 4) return;
    setBusy(true);
    const ok = await onSubmit(pin);
    setBusy(false);
    if (!ok) {
      setPin('');
      setError('Wrong PIN, or too many tries. After 5 wrong tries, wait 5 minutes.');
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} width={380}>
      <form onSubmit={submit} className="flex flex-col items-center pb-2 text-center">
        <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-on-accent-soft"><LockKeyhole size={22} /></div>
        <p className="mb-3 text-sm text-muted">Enter your chat PIN</p>
        <PinInput value={pin} onChange={(v) => { setPin(v); setError(''); }} autoFocus />
        {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
        <Button type="submit" className="mt-5 w-full" loading={busy} disabled={pin.length < 4}>Unlock</Button>
      </form>
    </Modal>
  );
}

/** Creates a PIN, or changes it (asks for the current one first). */
export function SetPinDialog({ open, onClose, hasPin, onDone }: { open: boolean; onClose: () => void; hasPin: boolean; onDone: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState<'current' | 'new' | 'confirm'>(hasPin ? 'current' : 'new');
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setStep(hasPin ? 'current' : 'new');
      setCurrent('');
      setPin('');
      setConfirm('');
      setError('');
    }
  }, [open, hasPin]);

  async function next(e: FormEvent) {
    e.preventDefault();
    if (step === 'current') {
      if (current.length < 4) return;
      setStep('new');
      return;
    }
    if (step === 'new') {
      if (pin.length < 4) return setError('Use 4 to 6 digits.');
      setStep('confirm');
      return;
    }
    if (confirm !== pin) {
      setConfirm('');
      return setError('The PINs do not match. Try again.');
    }
    setBusy(true);
    const { data, error: err } = await supabase.rpc('set_chat_pin', { p_new: pin, p_current: hasPin ? current : null });
    setBusy(false);
    if (err) return setError(errorMessage(err));
    if (!data) {
      setStep('current');
      setCurrent('');
      return setError('Your current PIN was wrong.');
    }
    toast(hasPin ? 'PIN changed' : 'Chat PIN set', 'success');
    onDone();
    onClose();
  }

  const label = step === 'current' ? 'Enter your current PIN' : step === 'new' ? 'Choose a 4 to 6 digit PIN' : 'Enter the same PIN again';
  const value = step === 'current' ? current : step === 'new' ? pin : confirm;
  const setValue = step === 'current' ? setCurrent : step === 'new' ? setPin : setConfirm;

  return (
    <Modal open={open} onClose={onClose} title={hasPin ? 'Change chat PIN' : 'Set a chat PIN'} width={380}>
      <form key={step} onSubmit={next} className="flex flex-col items-center pb-2 text-center">
        <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-on-accent-soft"><Lock size={22} /></div>
        <p className="mb-3 text-sm text-muted">{label}</p>
        <PinInput value={value} onChange={(v) => { setValue(v); setError(''); }} autoFocus />
        {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
        <Button type="submit" className="mt-5 w-full" loading={busy} disabled={value.length < 4}>
          {step === 'confirm' ? 'Save PIN' : 'Next'}
        </Button>
        {step === 'new' && <p className="mt-3 text-xs text-muted">You will use this PIN to open locked chats on any device.</p>}
      </form>
    </Modal>
  );
}

/** Forgot the PIN: confirm the account password, then the PIN is removed and chats unlocked. */
export function ForgotPinDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { email } = useMe();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) setPassword(''); }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setBusy(false);
      return toast('That password is not right.', 'error');
    }
    const { error: err } = await supabase.rpc('reset_chat_pin');
    setBusy(false);
    if (err) return toast(errorMessage(err), 'error');
    toast('Your PIN was removed and your chats are unlocked. You can set a new PIN.', 'success');
    onDone();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Forgot your PIN?"
      width={420}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!password}>Remove PIN</Button></>}
    >
      <p className="mb-4 text-sm text-muted">Enter your account password. Your PIN will be removed and all your locked chats will be unlocked.</p>
      <form onSubmit={submit}>
        <Field label="Account password">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
        </Field>
      </form>
    </Modal>
  );
}

/** Settings card for the chat PIN. */
export function ChatPinCard() {
  const { hasPin, refresh } = usePinStatus();
  const [setting, setSetting] = useState(false);
  const [forgot, setForgot] = useState(false);
  return (
    <section className="mb-6 rounded-2xl border border-line">
      <div className="px-5 pb-1 pt-4">
        <h2 className="text-[15px] font-semibold text-ink">Chat PIN</h2>
        <p className="mt-0.5 text-[13px] text-muted">
          Lock any chat from its details panel. Locked chats hide their previews and need your PIN to open.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-5 pb-5 pt-3">
        <span className={cx('mr-auto inline-flex items-center gap-2 text-sm', hasPin ? 'text-success' : 'text-muted')}>
          <Lock size={15} /> {hasPin === null ? 'Checking...' : hasPin ? 'PIN is set' : 'No PIN yet'}
        </span>
        <Button size="sm" variant="secondary" onClick={() => setSetting(true)} disabled={hasPin === null}>{hasPin ? 'Change PIN' : 'Set PIN'}</Button>
        {hasPin && <Button size="sm" variant="ghost" onClick={() => setForgot(true)}>Forgot PIN</Button>}
      </div>
      <SetPinDialog open={setting} onClose={() => setSetting(false)} hasPin={Boolean(hasPin)} onDone={refresh} />
      <ForgotPinDialog open={forgot} onClose={() => setForgot(false)} onDone={refresh} />
    </section>
  );
}
