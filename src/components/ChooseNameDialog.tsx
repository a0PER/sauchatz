import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useAuth, useMe } from '../contexts/AuthContext';
import { errorMessage } from '../lib/supabase';
import { Button, Field, Input, Logo } from './ui';

/** True when the profile name is still a placeholder or a copy of the email. */
export function needsRealName(displayName: string, email: string) {
  const name = displayName.trim().toLowerCase();
  const local = email.split('@')[0].toLowerCase();
  return name === 'new member' || name === local || name === email.toLowerCase() || name.includes('@');
}

/** Blocks the app until the person picks a public name, so emails are never shown. */
export function ChooseNameDialog() {
  const { profile, email } = useMe();
  const { updateProfile } = useAuth();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!needsRealName(profile.display_name, email)) return null;

  async function save(e: FormEvent) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return setError('Please enter a name.');
    if (needsRealName(clean, email)) return setError('Please use a name, not your email address.');
    setBusy(true);
    try {
      await updateProfile({ display_name: clean });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay p-4">
      <form onSubmit={save} className="animate-in w-full max-w-[420px] rounded-2xl bg-surface p-8 shadow-panel">
        <Logo size={32} />
        <h2 className="mt-5 text-xl font-semibold tracking-tight text-ink">Choose your name</h2>
        <p className="mt-1.5 text-sm text-muted">This is what everyone on Sauchatz sees. Your email stays private.</p>
        <div className="mt-6">
          <Field label="Your name">
            <Input value={name} onChange={(e) => { setName(e.target.value); setError(''); }} maxLength={60} autoFocus autoComplete="name" />
          </Field>
          {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
        </div>
        <div className="mt-6 flex justify-end">
          <Button type="submit" loading={busy} disabled={!name.trim()}>Continue</Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
