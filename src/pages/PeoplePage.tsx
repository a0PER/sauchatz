import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Lock, Search, Users } from 'lucide-react';
import { useMe } from '../contexts/AuthContext';
import { usePresence } from '../contexts/PresenceContext';
import { statusLabel } from '../lib/format';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';
import { Avatar, EmptyState, IconButton, Input, PresenceDot, Spinner, TestBadge } from '../components/ui';

const PAGE = 60;

export default function PeoplePage() {
  const { userId } = useMe();
  const { presenceOf, isOnline } = usePresence();
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [people, setPeople] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  async function load(offset: number, q: string) {
    let query = supabase.from('profiles').select('*').eq('is_public', true).neq('id', userId).order('display_name').range(offset, offset + PAGE - 1);
    const clean = q.trim().replace(/[%_]/g, '');
    if (clean) query = query.ilike('display_name', `%${clean}%`);
    const { data } = await query;
    const rows = (data as Profile[] | null) ?? [];
    setHasMore(rows.length === PAGE);
    return rows;
  }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(async () => {
      const rows = await load(0, term);
      if (alive) {
        setPeople(rows);
        setLoading(false);
      }
    }, 200);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, userId]);

  // Online people first, then alphabetical.
  const sorted = [...people].sort((a, b) => Number(isOnline(b.id)) - Number(isOnline(a.id)));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-line px-2 sm:px-6">
        <IconButton label="Back" className="md:hidden" onClick={() => navigate('/')}><ArrowLeft size={20} /></IconButton>
        <h1 className="text-[17px] font-semibold text-ink">Explore</h1>
        <div className="relative ml-auto w-full max-w-xs">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search by name" className="h-9 rounded-full pl-9" />
        </div>
      </header>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <p className="mb-4 flex items-center gap-2 text-[13px] text-muted">
          <Lock size={14} className="shrink-0" />
          Only public profiles are shown. People with private profiles can still chat with you if they message you first.
        </p>
        {loading ? (
          <div className="flex justify-center py-16"><Spinner size={24} /></div>
        ) : sorted.length === 0 ? (
          <EmptyState icon={<Users size={26} />} title={term ? 'No one matches that name' : 'No public profiles yet'} body={term ? 'Try a different spelling.' : 'Invite friends to sign up and they will show up here.'} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
              {sorted.map((p) => {
                const presence = presenceOf(p.id, p.status);
                return (
                  <Link key={p.id} to={`/u/${p.id}`} className="group overflow-hidden rounded-2xl border border-line bg-surface transition-shadow hover:shadow-panel">
                    <div className="relative aspect-[4/5] overflow-hidden bg-surface-2">
                      {p.avatar_url ? (
                        <img src={p.avatar_url} alt={p.display_name} loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                      ) : (
                        <div className="flex size-full items-center justify-center"><Avatar name={p.display_name} seed={p.id} size={88} /></div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent px-3.5 pb-3 pt-10 text-white">
                        <div className="flex items-center gap-1.5 truncate text-[15px] font-semibold">
                          {p.display_name}
                          {p.is_test && <TestBadge className="bg-white/85" />}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-white/85">
                          <PresenceDot presence={presence} className="border-white/70" />
                          {statusLabel(presence)}
                        </div>
                      </div>
                    </div>
                    <p className="line-clamp-2 min-h-[2.9em] px-3.5 py-2.5 text-[13px] text-muted">{p.description ? p.description.replace(/\s+/g, ' ') : <span className="italic text-subtle">No description yet</span>}</p>
                  </Link>
                );
              })}
            </div>
            {hasMore && (
              <div className="mt-6 flex justify-center">
                <button
                  className="text-sm font-medium text-accent hover:underline"
                  onClick={async () => {
                    const rows = await load(people.length, term);
                    setPeople((list) => [...list, ...rows]);
                  }}
                >
                  Show more
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
