import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Camera, Eye, EyeOff, Plus, ShieldCheck, ShieldAlert, Trash2, X } from 'lucide-react';
import { MAX_DESCRIPTION_LENGTH } from '../config';
import { useAuth, useMe } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { ACCEPT_ATTR, mediaPathFromUrl, removeMedia, uploadMedia, validateImage } from '../lib/images';
import {
  CLASS_YEARS, HERE_FOR, INTEREST_SUGGESTIONS, MAX_GALLERY, MAX_INTERESTS, MAX_PROMPTS, PROMPT_QUESTIONS, ageFrom,
} from '../lib/profileOptions';
import { errorMessage, supabase } from '../lib/supabase';
import type { Profile, ProfileDetails, ProfilePhoto, ProfilePrompt, Status } from '../lib/types';
import { cacheProfile } from '../lib/profileCache';
import { Avatar, Button, EmptyState, Field, IconButton, Input, Spinner, Textarea, Toggle, cx } from '../components/ui';
import { isAdult } from '../components/ChooseNameDialog';

function Section({ title, description, children, action }: { title: string; description?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Small switch between "Everyone" and "Only me" for one profile item. */
function Visibility({ hidden, onChange, label }: { hidden: boolean; onChange: (hidden: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!hidden)}
      aria-label={`${label}: ${hidden ? 'only me' : 'everyone'}. Click to change.`}
      title={hidden ? 'Only you can see this' : 'Everyone who can see your profile can see this'}
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        hidden ? 'border-line-strong bg-surface-2 text-muted' : 'border-transparent bg-accent-soft text-on-accent-soft',
      )}
    >
      {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
      {hidden ? 'Only me' : 'Everyone'}
    </button>
  );
}

function ToggleChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors',
        on ? 'border-accent bg-accent text-on-accent' : 'border-line-strong text-ink hover:bg-surface-2',
      )}
    >
      {children}
    </button>
  );
}

/** Your own profile. */
export default function EditProfilePage() {
  const { profile, userId } = useMe();
  const { details, updateProfile, updateDetails } = useAuth();
  return (
    <ProfileEditor
      userId={userId}
      profile={profile}
      details={details}
      saveProfile={updateProfile}
      saveDetails={updateDetails}
    />
  );
}

/** An admin editing someone else's profile. */
export function AdminEditProfilePage() {
  const { id = '' } = useParams();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<{ profile: Profile; details: ProfileDetails | null; photos: ProfilePhoto[] } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAdmin) return;
    supabase.rpc('admin_get_profile', { p_user: id }).then(({ data: d, error: e }) => {
      if (e) setError(errorMessage(e));
      else setData(d as { profile: Profile; details: ProfileDetails | null; photos: ProfilePhoto[] });
    });
  }, [id, isAdmin]);

  if (!isAdmin) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState icon={<ShieldAlert size={26} />} title="Admins only" body="You do not have access to this page." action={<Button variant="secondary" onClick={() => navigate('/')}>Go back</Button>} />
      </div>
    );
  }
  if (error) return <div className="flex flex-1 items-center justify-center p-6 text-sm text-danger">{error}</div>;
  if (!data) return <div className="flex flex-1 items-center justify-center"><Spinner size={24} /></div>;

  const adminSave = async (profilePatch: Partial<Profile>, detailsPatch: Partial<ProfileDetails>) => {
    const { error: e } = await supabase.rpc('admin_update_profile', { p_user: id, p_profile: profilePatch, p_details: detailsPatch });
    if (e) throw e;
    cacheProfile({ ...data.profile, ...profilePatch } as Profile);
  };

  return (
    <ProfileEditor
      key={id}
      admin
      userId={id}
      profile={data.profile}
      details={data.details}
      initialPhotos={data.photos}
      saveProfile={(patch) => adminSave(patch, {})}
      saveDetails={(patch) => adminSave({}, patch)}
    />
  );
}

interface EditorProps {
  userId: string;
  profile: Profile;
  details: ProfileDetails | null;
  initialPhotos?: ProfilePhoto[];
  admin?: boolean;
  saveProfile: (patch: Partial<Profile>) => Promise<void>;
  saveDetails: (patch: Partial<ProfileDetails>) => Promise<void>;
}

function ProfileEditor({ userId, profile, details, initialPhotos, admin = false, saveProfile, saveDetails }: EditorProps) {
  const updateProfile = saveProfile;
  const updateDetails = saveDetails;
  const toast = useToast();
  const navigate = useNavigate();
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url);
  const [status, setStatus] = useState<Status>(profile.status);
  const [nameLocked, setNameLocked] = useState(Boolean(profile.name_locked));
  const nameDisabled = !admin && Boolean(profile.name_locked);

  const [name, setName] = useState(profile.display_name);
  const [bio, setBio] = useState(profile.description);
  const [isPublic, setIsPublic] = useState(profile.is_public);
  const [birth, setBirth] = useState(details?.birth_date ?? '');
  const [classYear, setClassYear] = useState(details?.class_year ?? '');
  const [major, setMajor] = useState(details?.major ?? '');
  const [hometown, setHometown] = useState(details?.hometown ?? '');
  const [hereFor, setHereFor] = useState<string[]>(details?.here_for ?? []);
  const [interests, setInterests] = useState<string[]>(details?.interests ?? []);
  const [interestInput, setInterestInput] = useState('');
  const [prompts, setPrompts] = useState<ProfilePrompt[]>(details?.prompts ?? []);
  const [hidden, setHidden] = useState<string[]>(details?.hidden_fields ?? []);
  const isHidden = (k: string) => hidden.includes(k);
  const setItem = (k: string) => (h: boolean) => setHidden((list) => (h ? [...list.filter((x) => x !== k), k] : list.filter((x) => x !== k)));
  const [photos, setPhotos] = useState<ProfilePhoto[] | null>(initialPhotos ?? null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const avatarPicker = useRef<HTMLInputElement>(null);
  const galleryPicker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialPhotos) return;
    supabase.from('profile_photos').select('*').eq('user_id', userId).order('created_at').then(({ data }) => setPhotos((data as ProfilePhoto[]) ?? []));
  }, [userId, initialPhotos]);

  async function changeAvatar(f: File | undefined) {
    if (!f) return;
    const problem = validateImage(f);
    if (problem) return toast(problem, 'error');
    setUploading(true);
    try {
      const { url } = await uploadMedia(`users/${userId}/avatar`, f, 1200);
      const old = mediaPathFromUrl(avatarUrl);
      await updateProfile({ avatar_url: url });
      setAvatarUrl(url);
      if (old) removeMedia(old);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setUploading(false);
    }
  }

  async function removeAvatar() {
    const old = mediaPathFromUrl(avatarUrl);
    try {
      await updateProfile({ avatar_url: null });
      setAvatarUrl(null);
      if (old) removeMedia(old);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function addPhotos(files: FileList | null) {
    const list = [...(files ?? [])].filter((f) => !validateImage(f)).slice(0, MAX_GALLERY - (photos?.length ?? 0));
    if (!list.length) return;
    setUploading(true);
    try {
      for (const f of list) {
        const { path, url } = await uploadMedia(`users/${userId}/photos`, f, 1800);
        const { data, error } = await supabase.from('profile_photos').insert({ user_id: userId, storage_path: path, url, caption: '' }).select().single();
        if (error) throw error;
        setPhotos((p) => [...(p ?? []), data as ProfilePhoto]);
      }
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto(p: ProfilePhoto) {
    const { error } = await supabase.from('profile_photos').delete().eq('id', p.id);
    if (error) return toast(errorMessage(error), 'error');
    removeMedia(p.storage_path);
    setPhotos((list) => list?.filter((x) => x.id !== p.id) ?? null);
  }

  async function saveCaption(p: ProfilePhoto, caption: string) {
    if (caption === p.caption) return;
    await supabase.from('profile_photos').update({ caption }).eq('id', p.id);
    setPhotos((list) => list?.map((x) => (x.id === p.id ? { ...x, caption } : x)) ?? null);
  }

  function addInterest(raw: string) {
    const t = raw.trim().replace(/\s+/g, ' ').slice(0, 30);
    if (!t || interests.some((i) => i.toLowerCase() === t.toLowerCase()) || interests.length >= MAX_INTERESTS) return;
    setInterests([...interests, t]);
    setInterestInput('');
  }

  async function save() {
    if (!name.trim()) return toast('Please enter a name.', 'error');
    if (birth && !isAdult(birth)) return toast('Members must be 18 or older.', 'error');
    setSaving(true);
    try {
      await updateProfile({
        ...(nameDisabled ? {} : { display_name: name.trim() }),
        description: bio.trim(),
        is_public: isPublic,
        ...(admin ? { status, name_locked: nameLocked } : {}),
      });
      await updateDetails({
        birth_date: birth || null,
        class_year: classYear || null,
        major: major.trim() || null,
        hometown: hometown.trim() || null,
        here_for: hereFor,
        interests,
        prompts: prompts.filter((p) => p.answer.trim()).map((p) => ({ question: p.question, answer: p.answer.trim().slice(0, 300) })),
        hidden_fields: hidden,
      });
      toast(admin ? `Saved changes to ${name.trim()}` : 'Profile saved', 'success');
      navigate(`/u/${userId}`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  const unusedQuestions = PROMPT_QUESTIONS.filter((q) => !prompts.some((p) => p.question === q));
  const maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear() - 18);
  const age = ageFrom(birth);
  const selectClass = 'h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-line px-2 sm:px-6">
        <IconButton label="Back" onClick={() => navigate(-1)}><ArrowLeft size={20} /></IconButton>
        <h1 className="truncate text-[15px] font-semibold text-ink">{admin ? `Edit ${profile.display_name} (admin)` : 'Edit profile'}</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/u/${userId}`)}>Cancel</Button>
          <Button size="sm" loading={saving} onClick={save}>Save</Button>
        </div>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-bg/50">
        <div className="mx-auto max-w-xl space-y-4 px-4 pb-24 pt-6 sm:px-6">
          {admin && (
            <Section title="Admin controls" description="Changes here are saved to this person's profile when you press Save.">
              <div className="space-y-4">
                <p className="flex items-start gap-2 rounded-xl bg-accent-soft px-3.5 py-2.5 text-[13px] text-on-accent-soft">
                  <ShieldCheck size={16} className="mt-0.5 shrink-0" /> You are editing someone else's profile as an admin.
                </p>
                <Field label="Status">
                  <select value={status} onChange={(e) => setStatus(e.target.value as Status)} className={selectClass}>
                    <option value="active">Active</option>
                    <option value="away">Away</option>
                    <option value="dnd">Do not disturb</option>
                  </select>
                </Field>
                <div className="flex items-start justify-between gap-6">
                  <div>
                    <div className="text-sm text-ink">Lock their name</div>
                    <p className="mt-0.5 text-[13px] text-muted">They cannot change their name while this is on.</p>
                  </div>
                  <Toggle checked={nameLocked} onChange={setNameLocked} label="Lock their name" />
                </div>
                <div className="flex items-start justify-between gap-6">
                  <div>
                    <div className="text-sm text-ink">Public profile</div>
                    <p className="mt-0.5 text-[13px] text-muted">{isPublic ? 'Anyone can find them in Explore.' : 'Private: hidden from Explore and search.'}</p>
                  </div>
                  <Toggle checked={isPublic} onChange={setIsPublic} label="Public profile" />
                </div>
              </div>
            </Section>
          )}
          <Section title="Photos" description="Your main picture is always shown. Add up to 9 more; they appear between your prompts." action={<Visibility hidden={isHidden('photos')} onChange={setItem('photos')} label="Extra photos" />}>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => avatarPicker.current?.click()}
                className="group relative col-span-1 row-span-1 aspect-[4/5] overflow-hidden rounded-2xl bg-surface-2 ring-2 ring-accent ring-offset-2 ring-offset-surface"
                aria-label="Change main picture"
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center"><Avatar name={profile.display_name} seed={userId} size={56} /></span>
                )}
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1.5 pt-5 text-[11px] font-semibold text-white">Main</span>
                <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white opacity-0 transition-opacity group-hover:opacity-100"><Camera size={20} /></span>
              </button>
              {photos === null ? (
                <div className="flex aspect-[4/5] items-center justify-center"><Spinner /></div>
              ) : (
                photos.map((p) => (
                  <div key={p.id} className="group relative aspect-[4/5] overflow-hidden rounded-2xl bg-surface-2">
                    <img src={p.url} alt="" className="size-full object-cover" />
                    <button onClick={() => removePhoto(p)} className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75" aria-label="Remove photo">
                      <Trash2 size={14} />
                    </button>
                    <input
                      defaultValue={p.caption}
                      onBlur={(e) => saveCaption(p, e.target.value.trim())}
                      placeholder="Caption"
                      maxLength={300}
                      className="absolute inset-x-1.5 bottom-1.5 rounded-lg bg-black/45 px-2 py-1 text-[11px] text-white placeholder:text-white/70 outline-none backdrop-blur-sm focus:bg-black/65"
                    />
                  </div>
                ))
              )}
              {photos !== null && photos.length < MAX_GALLERY && (
                <button onClick={() => galleryPicker.current?.click()} className="flex aspect-[4/5] flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-line-strong text-muted hover:border-accent hover:text-accent">
                  {uploading ? <Spinner /> : <Plus size={22} />}
                  <span className="text-xs font-medium">Add photo</span>
                </button>
              )}
            </div>
            {avatarUrl && (
              <button onClick={removeAvatar} className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-danger">
                <Trash2 size={14} /> Remove main picture
              </button>
            )}
            <input ref={avatarPicker} type="file" accept={ACCEPT_ATTR} hidden onChange={(e) => { changeAvatar(e.target.files?.[0]); e.target.value = ''; }} />
            <input ref={galleryPicker} type="file" accept={ACCEPT_ATTR} multiple hidden onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />
          </Section>

          <Section title="The basics" description="Choose who sees each item. Your exact birthday is never shown, only your age.">
            <div className="space-y-4">
              <Field label="Name" hint={nameDisabled ? 'Your name was set by an admin and cannot be changed.' : undefined}>
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} disabled={nameDisabled} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                <Field label="Birthday" hint={age !== null ? `Shown as your age: ${age}` : 'Only your age is shown.'}>
                  <Input type="date" value={birth} max={maxDate.toISOString().slice(0, 10)} onChange={(e) => setBirth(e.target.value)} />
                </Field>
                  <div className="mt-2"><Visibility hidden={isHidden('age')} onChange={setItem('age')} label="Age" /></div>
                </div>
                <div>
                <Field label="Class year">
                  <select value={classYear} onChange={(e) => setClassYear(e.target.value)} className={selectClass}>
                    <option value="">Choose</option>
                    {CLASS_YEARS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                  <div className="mt-2"><Visibility hidden={isHidden('class_year')} onChange={setItem('class_year')} label="Class year" /></div>
                </div>
                <div>
                <Field label="Major">
                  <Input value={major} onChange={(e) => setMajor(e.target.value)} maxLength={80} placeholder="e.g. Nursing" />
                </Field>
                  <div className="mt-2"><Visibility hidden={isHidden('major')} onChange={setItem('major')} label="Major" /></div>
                </div>
                <div>
                <Field label="Hometown">
                  <Input value={hometown} onChange={(e) => setHometown(e.target.value)} maxLength={80} placeholder="e.g. Orlando, FL" />
                </Field>
                  <div className="mt-2"><Visibility hidden={isHidden('hometown')} onChange={setItem('hometown')} label="Hometown" /></div>
                </div>
              </div>
            </div>
          </Section>

          <Section title="About me">
            <Field label="Bio" counter={`${bio.length}/${MAX_DESCRIPTION_LENGTH}`}>
              <Textarea rows={4} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={MAX_DESCRIPTION_LENGTH} placeholder="What should people know about you?" />
            </Field>
          </Section>

          <Section title="Here for" description="Pick what you are open to." action={<Visibility hidden={isHidden('here_for')} onChange={setItem('here_for')} label="Here for" />}>
            <div className="flex flex-wrap gap-2">
              {HERE_FOR.map((h) => (
                <ToggleChip key={h} on={hereFor.includes(h)} onClick={() => setHereFor(hereFor.includes(h) ? hereFor.filter((x) => x !== h) : [...hereFor, h])}>{h}</ToggleChip>
              ))}
            </div>
          </Section>

          <Section title="Interests" description={`Up to ${MAX_INTERESTS}. Tap a suggestion or type your own.`} action={<Visibility hidden={isHidden('interests')} onChange={setItem('interests')} label="Interests" />}>
            {interests.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {interests.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-[13px] font-medium text-on-accent">
                    {t}
                    <button onClick={() => setInterests(interests.filter((x) => x !== t))} aria-label={`Remove ${t}`} className="-mr-1 rounded-full p-0.5 hover:bg-white/20"><X size={13} /></button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={interestInput}
                onChange={(e) => setInterestInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addInterest(interestInput); } }}
                placeholder="Add an interest"
                maxLength={30}
                disabled={interests.length >= MAX_INTERESTS}
              />
              <Button variant="secondary" onClick={() => addInterest(interestInput)} disabled={!interestInput.trim() || interests.length >= MAX_INTERESTS}>Add</Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {INTEREST_SUGGESTIONS.filter((s) => !interests.includes(s)).slice(0, 16).map((s) => (
                <button key={s} onClick={() => addInterest(s)} disabled={interests.length >= MAX_INTERESTS} className="rounded-full border border-dashed border-line-strong px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-40">
                  + {s}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Prompts" description={`Answer up to ${MAX_PROMPTS}. They are the best conversation starters.`} action={<Visibility hidden={isHidden('prompts')} onChange={setItem('prompts')} label="Prompts" />}>
            <div className="space-y-3">
              {prompts.map((p, i) => (
                <div key={i} className="rounded-2xl border border-line p-4">
                  <div className="flex items-center gap-2">
                    <select
                      value={p.question}
                      onChange={(e) => setPrompts(prompts.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))}
                      className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold text-muted outline-none"
                    >
                      {[p.question, ...unusedQuestions].map((q) => <option key={q} value={q}>{q}</option>)}
                    </select>
                    <IconButton label="Remove prompt" size={30} onClick={() => setPrompts(prompts.filter((_, j) => j !== i))}><X size={16} /></IconButton>
                  </div>
                  <Textarea
                    rows={2}
                    value={p.answer}
                    onChange={(e) => setPrompts(prompts.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))}
                    maxLength={300}
                    placeholder="Your answer"
                    className="mt-2 border-0 px-0 text-[16px] font-medium focus:ring-0"
                  />
                </div>
              ))}
              {prompts.length < MAX_PROMPTS && unusedQuestions.length > 0 && (
                <button
                  onClick={() => setPrompts([...prompts, { question: unusedQuestions[0], answer: '' }])}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line-strong py-4 text-sm font-medium text-muted hover:border-accent hover:text-accent"
                >
                  <Plus size={17} /> Add a prompt
                </button>
              )}
            </div>
          </Section>

{!admin && (
          <Section title="Who can see your profile">
            <div className="flex items-start justify-between gap-6">
              <div>
                <div className="text-sm text-ink">Public profile</div>
                <p className="mt-0.5 text-[13px] text-muted">
                  {isPublic
                    ? 'Everyone on SAUchatz can find you in People and see your full profile.'
                    : 'You are hidden from People and search. Only people you already chat with can see your photos and details.'}
                </p>
              </div>
              <Toggle checked={isPublic} onChange={setIsPublic} label="Public profile" />
            </div>
          </Section>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => navigate(`/u/${userId}`)}>Cancel</Button>
            <Button loading={saving} onClick={save}>Save profile</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
