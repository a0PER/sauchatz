import { Link } from 'react-router-dom';
import { ArrowRight, Camera, MessageSquarePlus, UsersRound } from 'lucide-react';
import { useMe } from '../contexts/AuthContext';
import { useShell } from './AppShell';

/** Shown in the main panel when no conversation is open. */
export default function HomePage() {
  const { profile } = useMe();
  const { openNewChat, openNewGroup } = useShell();
  const needsSetup = !profile.avatar_url || !profile.description;

  return (
    <div className="scroll-thin flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-10">
      <div className="w-full max-w-md text-center">
        <svg viewBox="0 0 160 110" className="mx-auto mb-6 w-40" aria-hidden="true">
          <rect x="18" y="14" width="96" height="58" rx="14" className="fill-accent-soft" />
          <rect x="34" y="32" width="52" height="7" rx="3.5" className="fill-accent opacity-60" />
          <rect x="34" y="46" width="34" height="7" rx="3.5" className="fill-accent opacity-35" />
          <path d="M40 72 l-10 16 22-16z" className="fill-accent-soft" />
          <rect x="62" y="48" width="80" height="46" rx="12" className="fill-surface-3" />
          <rect x="76" y="64" width="44" height="6" rx="3" className="fill-subtle opacity-50" />
          <rect x="76" y="76" width="28" height="6" rx="3" className="fill-subtle opacity-35" />
        </svg>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Welcome, {profile.display_name.split(' ')[0]}</h1>
        <p className="mt-2 text-sm text-muted">Pick a conversation on the left, or start a new one.</p>
        <div className="mt-7 grid gap-2.5 sm:grid-cols-2">
          <button onClick={openNewChat} className="flex items-center gap-3 rounded-xl border border-line px-4 py-3.5 text-left hover:bg-surface-2">
            <MessageSquarePlus size={20} className="shrink-0 text-accent" />
            <span className="text-sm font-medium text-ink">Message someone</span>
          </button>
          <button onClick={openNewGroup} className="flex items-center gap-3 rounded-xl border border-line px-4 py-3.5 text-left hover:bg-surface-2">
            <UsersRound size={20} className="shrink-0 text-accent" />
            <span className="text-sm font-medium text-ink">Create a group</span>
          </button>
        </div>
        {needsSetup && (
          <Link
            to="/profile/edit"
            className="mt-6 flex items-center gap-3.5 rounded-xl bg-accent-soft px-4 py-3.5 text-left text-on-accent-soft hover:brightness-[0.98]"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface/70"><Camera size={18} /></span>
            <span className="flex-1">
              <span className="block text-sm font-semibold">Finish your profile</span>
              <span className="block text-[13px] opacity-80">Add a picture and a short description so people know who you are.</span>
            </span>
            <ArrowRight size={18} className="shrink-0" />
          </Link>
        )}
      </div>
    </div>
  );
}
