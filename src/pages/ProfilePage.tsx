import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Ban, Camera, Flag, ImagePlus, MessageSquare, MoreHorizontal, Pencil, Trash2, UserX } from 'lucide-react';
import { MAX_DESCRIPTION_LENGTH } from '../config';
import { useAuth, useMe } from '../contexts/AuthContext';
import { usePresence } from '../contexts/PresenceContext';
import { useToast } from '../contexts/ToastContext';
import { formatFullDate, formatMonthYear, plural, statusLabel } from '../lib/format';
import { ACCEPT_ATTR, mediaPathFromUrl, removeMedia, uploadMedia, validateImage } from '../lib/images';
import { cacheProfile } from '../lib/profileCache';
import { errorMessage, supabase } from '../lib/supabase';
import type { Profile, ProfilePhoto } from '../lib/types';
import { Avatar, Button, EmptyState, Field, IconButton, Input, Menu, Modal, Spinner, Textarea } from '../components/ui';
import { ConfirmDialog, ReportDialog } from '../components/Dialogs';
import { Lightbox } from '../components/Lightbox';

export default function ProfilePage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { userId, profile: me } = useMe();
  const { presenceOf } = usePresence();
  const toast = useToast();
  const navigate = useNavigate();
  const isMe = id === userId;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [photos, setPhotos] = useState<ProfilePhoto[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [blocked, setBlocked] = useState(false);
  const [opening, setOpening] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const [editOpen, setEditOpen] = useState(params.get('edit') === '1');
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [confirm, setConfirm] = useState<'block' | 'photo' | null>(null);
  const [photoToDelete, setPhotoToDelete] = useState<ProfilePhoto | null>(null);
  const [reporting, setReporting] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const loadPhotos = useCallback(async () => {
    const { data } = await supabase.from('profile_photos').select('*').eq('user_id', id).order('created_at', { ascending: false });
    setPhotos((data as ProfilePhoto[] | null) ?? []);
  }, [id]);

  useEffect(() => {
    let alive = true;
    setState('loading');
    setViewer(null);
    (async () => {
      const [{ data: p }, , { data: b }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', id).maybeSingle(),
        loadPhotos(),
        isMe ? Promise.resolve({ data: null }) : supabase.from('blocks').select('blocked_id').eq('blocked_id', id).maybeSingle(),
      ]);
      if (!alive) return;
      if (!p) return setState('missing');
      cacheProfile(p as Profile);
      setProfile(p as Profile);
      setBlocked(Boolean(b));
      setState('ready');
    })();
    return () => { alive = false; };
  }, [id, isMe, loadPhotos]);

  // Keep my own profile in sync after edits.
  useEffect(() => { if (isMe) setProfile(me); }, [isMe, me]);

  useEffect(() => {
    if (params.get('edit') === '1') {
      setEditOpen(true);
      params.delete('edit');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  async function message() {
    setOpening(true);
    const { data, error } = await supabase.rpc('get_or_create_direct', { other_user: id });
    setOpening(false);
    if (error) return toast(errorMessage(error), 'error');
    navigate(`/c/${data}`);
  }

  async function block() {
    const { error } = await supabase.from('blocks').insert({ blocker_id: userId, blocked_id: id });
    if (error) return toast(errorMessage(error), 'error');
    setBlocked(true);
    toast(`${profile?.display_name} is blocked`);
  }

  async function unblock() {
    const { error } = await supabase.from('blocks').delete().eq('blocked_id', id);
    if (error) return toast(errorMessage(error), 'error');
    setBlocked(false);
    toast(`${profile?.display_name} is unblocked`);
  }

  async function deletePhoto(p: ProfilePhoto) {
    const { error } = await supabase.from('profile_photos').delete().eq('id', p.id);
    if (error) return toast(errorMessage(error), 'error');
    removeMedia(p.storage_path);
    setPhotos((list) => list.filter((x) => x.id !== p.id));
    setViewer(null);
    toast('Photo deleted');
  }

  function choosePhotos(files: FileList | null) {
    const list = [...(files ?? [])];
    const bad = list.find((f) => validateImage(f));
    if (bad) toast(validateImage(bad)!, 'error');
    const ok = list.filter((f) => !validateImage(f)).slice(0, 10);
    if (ok.length) setUploadFiles(ok);
  }

  if (state === 'missing') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState icon={<UserX size={26} />} title="Profile not found" body="This account may have been deleted." action={<Button variant="secondary" onClick={() => navigate('/')}>Go back</Button>} />
      </div>
    );
  }
  if (state === 'loading' || !profile) {
    return <div className="flex flex-1 items-center justify-center"><Spinner size={24} /></div>;
  }

  const presence = presenceOf(profile.id, profile.status);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-line px-2 sm:px-6">
        <IconButton label="Back" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}><ArrowLeft size={20} /></IconButton>
        <h1 className="truncate text-[15px] font-semibold text-ink">{isMe ? 'Your profile' : profile.display_name}</h1>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-5 pb-16 pt-8 sm:px-8">
          {/* Header */}
          <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:items-center sm:text-left">
            <button
              onClick={() => isMe && setEditOpen(true)}
              className={isMe ? 'relative rounded-full' : 'relative cursor-default rounded-full'}
              aria-label={isMe ? 'Change profile picture' : 'Profile picture'}
            >
              <Avatar src={profile.avatar_url} name={profile.display_name} seed={profile.id} size={112} presence={presence} />
            </button>
            <div className="min-w-0 flex-1">
              <h2 className="text-2xl font-semibold tracking-tight text-ink">{profile.display_name}</h2>
              <p className="mt-1 text-sm text-muted">
                {statusLabel(presence)} · Joined {formatMonthYear(profile.created_at)}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
                {isMe ? (
                  <>
                    <Button variant="secondary" size="sm" icon={<Pencil size={15} />} onClick={() => setEditOpen(true)}>Edit profile</Button>
                    <Button variant="tonal" size="sm" icon={<ImagePlus size={15} />} onClick={() => picker.current?.click()}>Add photos</Button>
                  </>
                ) : blocked ? (
                  <Button variant="secondary" size="sm" icon={<Ban size={15} />} onClick={unblock}>Unblock</Button>
                ) : (
                  <Button size="sm" icon={<MessageSquare size={15} />} loading={opening} onClick={message}>Message</Button>
                )}
                {!isMe && (
                  <Menu
                    align="left"
                    trigger={(t) => (
                      <button {...t} className="inline-flex size-8 items-center justify-center rounded-full border border-line-strong text-ink hover:bg-surface-2" aria-label="More options">
                        <MoreHorizontal size={17} />
                      </button>
                    )}
                    items={[
                      blocked
                        ? { label: 'Unblock', icon: <Ban size={16} />, onSelect: unblock }
                        : { label: 'Block', icon: <Ban size={16} />, danger: true, onSelect: () => setConfirm('block') },
                      { label: 'Report', icon: <Flag size={16} />, danger: true, onSelect: () => setReporting(true) },
                    ]}
                  />
                )}
              </div>
            </div>
          </div>

          {/* About */}
          <section className="mt-9">
            <h3 className="mb-2 text-[13px] font-semibold text-ink">About</h3>
            {profile.description ? (
              <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">{profile.description}</p>
            ) : isMe ? (
              <button onClick={() => setEditOpen(true)} className="text-sm text-accent hover:underline">Add a description so people know a little about you</button>
            ) : (
              <p className="text-sm text-muted">{profile.display_name} has not written a description yet.</p>
            )}
          </section>

          {/* Photos */}
          <section className="mt-9">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-[13px] font-semibold text-ink">Photos <span className="font-normal text-muted">{photos.length > 0 && `· ${photos.length}`}</span></h3>
            </div>
            {photos.length === 0 ? (
              isMe ? (
                <button
                  onClick={() => picker.current?.click()}
                  className="flex w-full flex-col items-center rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center hover:bg-surface-2"
                >
                  <Camera size={26} className="text-muted" />
                  <span className="mt-2 text-sm font-medium text-ink">Share your first photos</span>
                  <span className="mt-0.5 text-[13px] text-muted">Anyone who visits your profile can scroll through them.</span>
                </button>
              ) : (
                <p className="text-sm text-muted">No photos yet.</p>
              )
            ) : (
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {photos.map((p, i) => (
                  <button key={p.id} onClick={() => setViewer(i)} className="group relative aspect-square overflow-hidden rounded-xl bg-surface-2">
                    <img src={p.url} alt={p.caption || ''} loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                    {p.caption && (
                      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 pb-2 pt-6 text-left text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                        <span className="line-clamp-2">{p.caption}</span>
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <input ref={picker} type="file" accept={ACCEPT_ATTR} multiple hidden onChange={(e) => { choosePhotos(e.target.files); e.target.value = ''; }} />

      <Lightbox
        items={photos.map((p) => ({
          src: p.url,
          caption: p.caption,
          meta: formatFullDate(p.created_at),
          actions: isMe ? (
            <button onClick={() => { setPhotoToDelete(p); setConfirm('photo'); }} className="rounded-full p-2 hover:bg-white/10" aria-label="Delete photo">
              <Trash2 size={20} />
            </button>
          ) : undefined,
        }))}
        index={viewer}
        onClose={() => setViewer(null)}
        onIndexChange={setViewer}
      />

      {isMe && <EditProfileDialog open={editOpen} onClose={() => setEditOpen(false)} />}
      {isMe && (
        <UploadPhotosDialog
          files={uploadFiles}
          onClose={() => setUploadFiles([])}
          onDone={() => { setUploadFiles([]); loadPhotos(); }}
        />
      )}
      <ConfirmDialog
        open={confirm === 'block'}
        onClose={() => setConfirm(null)}
        title={`Block ${profile.display_name}?`}
        body="They will not be able to message you or add you to groups. They will not be told that you blocked them."
        confirmLabel="Block"
        danger
        onConfirm={block}
      />
      <ConfirmDialog
        open={confirm === 'photo'}
        onClose={() => { setConfirm(null); setPhotoToDelete(null); }}
        title="Delete this photo?"
        body="It will be removed from your profile."
        confirmLabel="Delete"
        danger
        onConfirm={() => (photoToDelete ? deletePhoto(photoToDelete) : undefined)}
      />
      {!isMe && <ReportDialog open={reporting} onClose={() => setReporting(false)} userId={profile.id} userName={profile.display_name} />}
    </div>
  );
}

/* ---------------------------- Edit profile ---------------------------- */

function EditProfileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile, userId } = useMe();
  const { updateProfile } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(profile.display_name);
  const [description, setDescription] = useState(profile.description);
  const [avatar, setAvatar] = useState<string | null>(profile.avatar_url);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const filePreview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (filePreview) URL.revokeObjectURL(filePreview); }, [filePreview]);

  useEffect(() => {
    if (open) {
      setName(profile.display_name);
      setDescription(profile.description);
      setAvatar(profile.avatar_url);
      setFile(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function save() {
    if (!name.trim()) return toast('Please enter a name.', 'error');
    setBusy(true);
    try {
      let avatar_url = avatar;
      if (file) avatar_url = (await uploadMedia(`users/${userId}/avatar`, file, 512)).url;
      await updateProfile({ display_name: name.trim(), description: description.trim(), avatar_url });
      const oldPath = mediaPathFromUrl(profile.avatar_url);
      if (oldPath && avatar_url !== profile.avatar_url) removeMedia(oldPath);
      toast('Profile saved', 'success');
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit profile"
      width={520}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}
    >
      <div className="mb-6 flex items-center gap-5">
        <button onClick={() => picker.current?.click()} className="group relative rounded-full" aria-label="Change profile picture">
          <Avatar src={filePreview ?? avatar} name={name || profile.display_name} seed={userId} size={88} />
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100">
            <Camera size={22} />
          </span>
        </button>
        <div className="flex flex-col items-start gap-1.5">
          <Button size="sm" variant="secondary" icon={<Camera size={15} />} onClick={() => picker.current?.click()}>
            {avatar || file ? 'Change picture' : 'Upload picture'}
          </Button>
          {(avatar || file) && (
            <button className="text-xs font-medium text-danger hover:underline" onClick={() => { setAvatar(null); setFile(null); }}>Remove picture</button>
          )}
          <span className="text-xs text-muted">JPG, PNG, WebP or GIF.</span>
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
        <Field label="Name" hint="This is how you appear to everyone.">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </Field>
        <Field label="Description" counter={`${description.length}/${MAX_DESCRIPTION_LENGTH}`}>
          <Textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={MAX_DESCRIPTION_LENGTH} placeholder="Tell people a little about yourself" />
        </Field>
      </div>
    </Modal>
  );
}

/* ---------------------------- Upload photos ---------------------------- */

function UploadPhotosDialog({ files, onClose, onDone }: { files: File[]; onClose: () => void; onDone: () => void }) {
  const { userId } = useMe();
  const toast = useToast();
  const [captions, setCaptions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);
  useEffect(() => { setCaptions(files.map(() => '')); setProgress(0); }, [files]);

  async function post() {
    setBusy(true);
    let done = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        const { path, url } = await uploadMedia(`users/${userId}/photos`, files[i], 2000);
        const { error } = await supabase.from('profile_photos').insert({ user_id: userId, storage_path: path, url, caption: (captions[i] ?? '').trim() });
        if (error) throw error;
        done++;
        setProgress(done);
      }
      toast(`${plural(done, 'photo')} added to your profile`, 'success');
      onDone();
    } catch (e) {
      toast(errorMessage(e), 'error');
      if (done > 0) onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={files.length > 0}
      onClose={busy ? () => {} : onClose}
      title={`Add ${plural(files.length, 'photo')}`}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={post} loading={busy}>{busy ? `Uploading ${progress + 1} of ${files.length}` : 'Post to profile'}</Button>
        </>
      }
    >
      <div className="space-y-3">
        {files.map((f, i) => (
          <div key={f.name + i} className="flex gap-3">
            <img src={previews[i]} alt="" className="size-20 shrink-0 rounded-lg border border-line object-cover" />
            <Textarea
              rows={3}
              value={captions[i] ?? ''}
              onChange={(e) => setCaptions((c) => c.map((x, j) => (j === i ? e.target.value : x)))}
              maxLength={300}
              placeholder="Write a caption (optional)"
            />
          </div>
        ))}
      </div>
    </Modal>
  );
}
