import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Ban, BadgeCheck, BookOpen, MailWarning, Flag, GraduationCap, Heart, Lock, MapPin, MessageSquare, MoreHorizontal, Pencil, Sparkles, UserX,
} from 'lucide-react';
import { useMe } from '../contexts/AuthContext';
import { usePresence } from '../contexts/PresenceContext';
import { useToast } from '../contexts/ToastContext';
import { formatFullDate, statusLabel } from '../lib/format';
import { cacheProfile } from '../lib/profileCache';
import { ageFrom } from '../lib/profileOptions';
import { errorMessage, supabase } from '../lib/supabase';
import type { Profile, ProfileDetails, ProfilePhoto, ProfilePrompt, PublicDetails } from '../lib/types';

interface ViewDetails {
  age: number | null;
  class_year: string | null;
  major: string | null;
  hometown: string | null;
  here_for: string[];
  interests: string[];
  prompts: ProfilePrompt[];
  hidden: string[];
}

const ITEM_LABELS: Record<string, string> = {
  age: 'Age', class_year: 'Class year', major: 'Major', hometown: 'Hometown', here_for: 'Here for',
  interests: 'Interests', prompts: 'Prompts', photos: 'Photos',
};
import { Avatar, Button, EmptyState, IconButton, Menu, PresenceDot, Spinner, cx } from '../components/ui';
import { ConfirmDialog, ReportDialog } from '../components/Dialogs';
import { Lightbox } from '../components/Lightbox';

function Chip({ icon, children, tone = 'plain' }: { icon?: ReactNode; children: ReactNode; tone?: 'plain' | 'accent' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium',
        tone === 'accent' ? 'bg-accent-soft text-on-accent-soft' : 'border border-line-strong text-ink',
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('rounded-3xl border border-line bg-surface p-6', className)}>{children}</section>;
}

export default function ProfilePage() {
  const { id = '' } = useParams();
  const { userId } = useMe();
  const { presenceOf } = usePresence();
  const toast = useToast();
  const navigate = useNavigate();
  const isMe = id === userId;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [details, setDetails] = useState<ViewDetails | null>(null);
  const [photos, setPhotos] = useState<ProfilePhoto[]>([]);
  const [canView, setCanView] = useState(true);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [blocked, setBlocked] = useState(false);
  const [opening, setOpening] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [hearts, setHearts] = useState<number | null>(null);
  const [hearted, setHearted] = useState(false);
  const [heartBusy, setHeartBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: p } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
    if (!p) return setState('missing');
    cacheProfile(p as Profile);
    setProfile(p as Profile);
    const visible = isMe || (p as Profile).is_public || Boolean((await supabase.rpc('shares_conversation', { other: id })).data);
    setCanView(visible);
    const [{ data: d }, { data: ph }, { data: b }] = await Promise.all([
      isMe
        ? supabase.from('profile_details').select('*').eq('user_id', id).maybeSingle()
        : supabase.rpc('get_profile_details', { p_user: id }).maybeSingle(),
      supabase.from('profile_photos').select('*').eq('user_id', id).order('created_at', { ascending: true }),
      isMe ? Promise.resolve({ data: null }) : supabase.from('blocks').select('blocked_id').eq('blocked_id', id).maybeSingle(),
    ]);
    if (!d) setDetails(null);
    else if (isMe) {
      const own = d as ProfileDetails;
      setDetails({ ...own, age: ageFrom(own.birth_date), hidden: own.hidden_fields ?? [] });
    } else {
      const pub = d as PublicDetails;
      setDetails({ ...pub, prompts: pub.prompts ?? [], here_for: pub.here_for ?? [], interests: pub.interests ?? [], hidden: [] });
    }
    setPhotos((ph as ProfilePhoto[] | null) ?? []);
    setBlocked(Boolean(b));
    const [{ data: hc }, { data: mine }] = await Promise.all([
      supabase.rpc('heart_count', { p_user: id }),
      isMe ? Promise.resolve({ data: null }) : supabase.from('profile_hearts').select('to_user').eq('to_user', id).maybeSingle(),
    ]);
    setHearts(typeof hc === 'number' ? hc : null);
    setHearted(Boolean(mine));
    setState('ready');
  }, [id, isMe]);

  useEffect(() => {
    setState('loading');
    setViewer(null);
    load();
  }, [load]);

  async function message() {
    setOpening(true);
    const { data, error } = await supabase.rpc('get_or_create_direct', { other_user: id });
    setOpening(false);
    if (error) return toast(errorMessage(error), 'error');
    navigate(`/c/${data}`);
  }

  async function toggleHeart() {
    setHeartBusy(true);
    const next = !hearted;
    setHearted(next);
    setHearts((n) => (n === null ? n : n + (next ? 1 : -1)));
    const { error } = next
      ? await supabase.from('profile_hearts').insert({ to_user: id })
      : await supabase.from('profile_hearts').delete().eq('to_user', id);
    setHeartBusy(false);
    if (error) {
      setHearted(!next);
      setHearts((n) => (n === null ? n : n + (next ? -1 : 1)));
      return toast(errorMessage(error), 'error');
    }
    if (next) toast(`You sent ${profile?.display_name.split(' ')[0]} a heart`, 'success');
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
  const age = details?.age ?? null;
  const firstName = profile.display_name.split(' ')[0];
  const prompts = (details?.prompts ?? []).filter((p) => p.answer?.trim());
  const lightboxItems = photos.map((p) => ({ src: p.url, caption: p.caption, meta: formatFullDate(p.created_at) }));
  if (profile.avatar_url) lightboxItems.unshift({ src: profile.avatar_url, caption: '', meta: 'Profile picture' });
  const offset = profile.avatar_url ? 1 : 0;

  const actions = (
    <div className="flex items-center gap-2">
      {isMe ? (
        <Button icon={<Pencil size={16} />} onClick={() => navigate('/profile/edit')}>Edit profile</Button>
      ) : blocked ? (
        <Button variant="secondary" icon={<Ban size={16} />} onClick={unblock}>Unblock</Button>
      ) : (
        <>
          <Button icon={<MessageSquare size={16} />} loading={opening} onClick={message}>Message {firstName}</Button>
          <Button
            variant={hearted ? 'tonal' : 'secondary'}
            icon={<Heart size={16} className={hearted ? 'fill-current text-danger' : ''} />}
            onClick={toggleHeart}
            disabled={heartBusy}
            aria-pressed={hearted}
          >
            {hearted ? 'Heart sent' : 'Send a heart'}
          </Button>
        </>
      )}
      {!isMe && (
        <Menu
          trigger={(t) => (
            <button {...t} className="inline-flex size-10 items-center justify-center rounded-full border border-line-strong text-ink hover:bg-surface-2" aria-label="More options">
              <MoreHorizontal size={18} />
            </button>
          )}
          items={[
            blocked
              ? { label: 'Unblock', icon: <Ban size={16} />, onSelect: unblock }
              : { label: 'Block', icon: <Ban size={16} />, danger: true, onSelect: () => setConfirmBlock(true) },
            { label: 'Report', icon: <Flag size={16} />, danger: true, onSelect: () => setReporting(true) },
          ]}
        />
      )}
    </div>
  );

  // Interleave gallery photos with prompt answers, like a dating profile.
  const blocks: ReactNode[] = [];
  const maxLen = Math.max(photos.length, prompts.length);
  for (let i = 0; i < maxLen; i++) {
    const ph = photos[i];
    if (ph) {
      blocks.push(
        <button key={ph.id} onClick={() => setViewer(i + offset)} className="group relative block w-full overflow-hidden rounded-3xl bg-surface-2">
          <img src={ph.url} alt={ph.caption || `${firstName}'s photo`} loading="lazy" className="aspect-[4/5] w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
          {ph.caption && <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-5 pb-4 pt-10 text-left text-sm text-white">{ph.caption}</span>}
        </button>,
      );
    }
    const pr = prompts[i];
    if (pr) {
      blocks.push(
        <Card key={'p' + i} className="px-6 py-7">
          <p className="text-[13px] font-semibold text-muted">{pr.question}</p>
          <p className="mt-2 whitespace-pre-wrap text-[22px] font-semibold leading-snug tracking-tight text-ink">{pr.answer}</p>
        </Card>,
      );
    }
    if (i === 0 && (details?.interests?.length ?? 0) > 0) {
      blocks.push(
        <Card key="interests">
          <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-muted"><Sparkles size={15} /> Interests</h3>
          <div className="flex flex-wrap gap-2">{details!.interests.map((t) => <Chip key={t}>{t}</Chip>)}</div>
        </Card>,
      );
    }
  }
  if (maxLen === 0 && (details?.interests?.length ?? 0) > 0) {
    blocks.push(
      <Card key="interests">
        <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-muted"><Sparkles size={15} /> Interests</h3>
        <div className="flex flex-wrap gap-2">{details!.interests.map((t) => <Chip key={t}>{t}</Chip>)}</div>
      </Card>,
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-line px-2 sm:px-6">
        <IconButton label="Back" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}><ArrowLeft size={20} /></IconButton>
        <h1 className="truncate text-[15px] font-semibold text-ink">{isMe ? 'Your profile' : profile.display_name}</h1>
        {isMe && !profile.is_public && (
          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-muted"><Lock size={12} /> Private</span>
        )}
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-bg/50">
        <div className="mx-auto max-w-xl space-y-4 px-4 pb-20 pt-6 sm:px-6">
          {/* Hero photo */}
          <div className="relative overflow-hidden rounded-3xl bg-surface-2">
            {profile.avatar_url ? (
              <button onClick={() => setViewer(0)} className="block w-full" aria-label="Open profile picture">
                <img src={profile.avatar_url} alt={profile.display_name} className="aspect-[4/5] w-full object-cover" />
              </button>
            ) : (
              <div className="flex aspect-[4/5] w-full items-center justify-center">
                <Avatar name={profile.display_name} seed={profile.id} size={160} />
              </div>
            )}
            {hearts !== null && (
              <div className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-black/45 px-3 py-1.5 text-sm font-semibold text-white backdrop-blur-md" title={`${hearts} ${hearts === 1 ? 'heart' : 'hearts'}`}>
                <Heart size={15} className="fill-current text-[#ff6b8b]" />
                {hearts}
                {isMe && profile.show_hearts === false && <span className="font-normal text-white/75">· hidden</span>}
              </div>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-6 pb-6 pt-24 text-white">
              <h2 className="text-[30px] font-semibold leading-tight tracking-tight">
                {profile.display_name}{age !== null && canView && <span className="font-normal">, {age}</span>}
              </h2>
              <p className="mt-1 flex items-center gap-2 text-sm text-white/85">
                <PresenceDot presence={presence} className="border-white/70" />
                {statusLabel(presence)}
              </p>
              {profile.email_verified ? (
                <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-xs font-medium text-[#188038]">
                  <BadgeCheck size={14} /> Email verified
                </span>
              ) : (
                <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-black/45 px-2.5 py-1 text-xs font-medium text-white/90">
                  <MailWarning size={14} /> Email not verified
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-1">{actions}</div>

          {isMe && (details?.hidden.length ?? 0) > 0 && (
            <Link to="/profile/edit" className="flex items-center gap-2.5 rounded-2xl bg-surface-2 px-4 py-3 text-[13px] text-muted hover:text-ink">
              <Lock size={15} className="shrink-0" />
              <span>Hidden from others: {details!.hidden.map((h) => ITEM_LABELS[h] ?? h).join(', ')}. Only you can see these.</span>
            </Link>
          )}

          {!canView ? (
            <Card className="text-center">
              <Lock size={24} className="mx-auto text-muted" />
              <h3 className="mt-3 text-[15px] font-semibold text-ink">This profile is private</h3>
              <p className="mt-1 text-sm text-muted">{firstName} only shares their profile with people they are already chatting with.</p>
            </Card>
          ) : (
            <>
              {(details?.class_year || details?.major || details?.hometown || (details?.here_for?.length ?? 0) > 0) && (
                <Card>
                  <div className="flex flex-wrap gap-2">
                    {details?.class_year && <Chip icon={<GraduationCap size={15} />}>{details.class_year}</Chip>}
                    {details?.major && <Chip icon={<BookOpen size={15} />}>{details.major}</Chip>}
                    {details?.hometown && <Chip icon={<MapPin size={15} />}>{details.hometown}</Chip>}
                  </div>
                  {(details?.here_for?.length ?? 0) > 0 && (
                    <div className={cx(details?.class_year || details?.major || details?.hometown ? 'mt-5' : '')}>
                      <h3 className="mb-2.5 text-[13px] font-semibold text-muted">Here for</h3>
                      <div className="flex flex-wrap gap-2">{details!.here_for.map((h) => <Chip key={h} tone="accent">{h}</Chip>)}</div>
                    </div>
                  )}
                </Card>
              )}

              {profile.description ? (
                <Card>
                  <h3 className="mb-2 text-[13px] font-semibold text-muted">About {isMe ? 'me' : firstName}</h3>
                  <p className="whitespace-pre-wrap break-words text-[16px] leading-relaxed text-ink">{profile.description}</p>
                </Card>
              ) : isMe ? (
                <Link to="/profile/edit" className="block rounded-3xl border border-dashed border-line-strong p-6 text-center text-sm text-accent hover:bg-surface-2">
                  Add an about section, prompts and more photos
                </Link>
              ) : null}

              {blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}

              {isMe && photos.length === 0 && prompts.length === 0 && (
                <Link to="/profile/edit" className="block rounded-3xl border border-dashed border-line-strong p-6 text-center text-sm text-accent hover:bg-surface-2">
                  Add photos and answer a few prompts so people get to know you
                </Link>
              )}

              {!isMe && <div className="flex justify-center pt-4">{actions}</div>}
            </>
          )}
        </div>
      </div>

      <Lightbox items={lightboxItems} index={viewer} onClose={() => setViewer(null)} onIndexChange={setViewer} />
      <ConfirmDialog
        open={confirmBlock}
        onClose={() => setConfirmBlock(false)}
        title={`Block ${profile.display_name}?`}
        body="They will not be able to message you or add you to groups. They will not be told that you blocked them."
        confirmLabel="Block"
        danger
        onConfirm={block}
      />
      {!isMe && <ReportDialog open={reporting} onClose={() => setReporting(false)} userId={profile.id} userName={profile.display_name} />}
    </div>
  );
}
