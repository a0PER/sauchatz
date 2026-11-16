import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import type { Presence, Status } from '../lib/types';
import { useAuth } from './AuthContext';

interface PresenceState {
  isOnline: (userId: string) => boolean;
  presenceOf: (userId: string, status: Status | null | undefined) => Presence;
}

const PresenceContext = createContext<PresenceState>({
  isOnline: () => false,
  presenceOf: () => 'offline',
});

/** Tracks who has the app open right now, using Supabase Realtime presence. */
export function PresenceProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [online, setOnline] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;
    const channel = supabase.channel('presence:online', { config: { presence: { key: userId } } });
    channel
      .on('presence', { event: 'sync' }, () => {
        setOnline(new Set(Object.keys(channel.presenceState())));
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') channel.track({ at: new Date().toISOString() });
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const isOnline = useCallback((id: string) => online.has(id), [online]);
  const presenceOf = useCallback(
    (id: string, status: Status | null | undefined): Presence => (online.has(id) ? status ?? 'active' : 'offline'),
    [online],
  );

  return <PresenceContext.Provider value={{ isOnline, presenceOf }}>{children}</PresenceContext.Provider>;
}

export const usePresence = () => useContext(PresenceContext);
