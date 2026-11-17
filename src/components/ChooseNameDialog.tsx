import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Camera } from 'lucide-react';
import { MAX_DESCRIPTION_LENGTH } from '../config';
import { useAuth, useMe } from '../contexts/AuthContext';
import { ACCEPT_ATTR, uploadMedia, validateImage } from '../lib/images';
import { errorMessage } from '../lib/supabase';
import { Avatar, Button, Field, Input, Logo, Textarea } from './ui';

/** True when the profile name is a placeholder or a copy of the login. */
export function needsRealName(displayName: string, login: string) {
  const name = displayName.trim().toLowerCase();
  const local = login.split('@')[0].toLowerCase();
  const digitsOnly = name.replace(/\D/g, '');
  return name === 'new member' || name === local || name.includes('@') || (digitsOnly.length >= 7 && digitsOnly.length >= name.length - 4);
}

export function isAdult(birthDate: string) {
  const d = new Date(birthDate + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return false;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 18);
  return d <= cutoff;
}

/** First sign-in: name, birthday (18+), picture and a short bio. */
export function ChooseNameDialog() {
  const { profile, email, userId } = useMe();
  const { details, updateProfile, updateDetails } = useAuth();
  const [name, setName] = useState('');
  const [birth, setBirth] = useState('');
  const [bio, setBio] = useState(profile.description);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const nameOk = !needsRealName(profile.display_name, email);
  const show = !nameOk || (details !== null && !details.birth_date);
  useEffect(() => { if (show && nameOk) setName(profile.display_name); }, [show, nameOk, profile.display_name]);
  if (!show) return null;

  async function save(e: FormEvent) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean || needsRealName(clean, email)) return setError('Please enter your name, not your phone number.');
    if (!birth) return setError('Please enter your birthday.');
    if (!isAdult(birth)) return setError('You must be 18 or older to use Sauchatz.');
    setBusy(true);
    setError('');
    try {
      let avatar_url = profile.avatar_url;
      if (file) avatar_url = (await uploadMedia(`users/${userId}/avatar`, file, 800)).url;
      await updateDetails({ birth_date: birth });
      await updateProfile({ display_name: clean, description: bio.trim(), avatar_url });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear() - 18);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-overlay p-4">
      <form onSubmit={save} className="animate-in my-auto w-full max-w-[460px] rounded-2xl bg-surface p-7 shadow-panel sm:p-8">
        <Logo size={32} />
        <h2 className="mt-5 text-xl font-semibold tracking-tight text-ink">Set up your profile</h2>
        <p className="mt-1.5 text-sm text-muted">This is what other students see. You can add more photos and details later.</p>

        <div className="mt-6 flex items-center gap-4">
          <button type="button" onClick={() => picker.current?.click()} className="group relative rounded-full" aria-label="Add a profile picture">
            <Avatar src={preview ?? profile.avatar_url} name={name || '?'} seed={userId} size={84} />
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/35 text-white opacity-0 transition-opacity group-hover:opacity-100">
              <Camera size={22} />
            </span>
          </button>
          <div>
            <Button type="button" size="sm" variant="secondary" icon={<Camera size={15} />} onClick={() => picker.current?.click()}>
              {preview || profile.avatar_url ? 'Change picture' : 'Add a picture'}
            </Button>
            <p className="mt-1.5 text-xs text-muted">Optional, but profiles with a photo get more replies.</p>
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
              if (problem) return setError(problem);
              setFile(f);
            }}
          />
        </div>

        <div className="mt-6 space-y-4">
          <Field label="Your name">
            <Input value={name} onChange={(e) => { setName(e.target.value); setError(''); }} maxLength={60} autoFocus autoComplete="given-name" />
          </Field>
          <Field label="Birthday" hint="Only your age is shown. You must be 18 or older.">
            <Input type="date" value={birth} max={maxDate.toISOString().slice(0, 10)} onChange={(e) => { setBirth(e.target.value); setError(''); }} />
          </Field>
          <Field label="About you" counter={`${bio.length}/${MAX_DESCRIPTION_LENGTH}`}>
            <Textarea rows={3} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={MAX_DESCRIPTION_LENGTH} placeholder="A few words about yourself (optional)" />
          </Field>
          {error && <p className="text-[13px] text-danger">{error}</p>}
        </div>
        <div className="mt-6 flex justify-end">
          <Button type="submit" loading={busy}>Continue</Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
