import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { cacheProfile } from '../lib/profileCache';
import type { Profile, ProfileDetails, Theme, UserSettings } from '../lib/types';
import { applyLayout, cachedLayout, readLayout } from '../lib/layout';

interface AuthState {
  session: Session | null;
  loading: boolean;
  profile: Profile | null;
  settings: UserSettings | null;
  details: ProfileDetails | null;
  isAdmin: boolean;
  updateDetails: (patch: Partial<ProfileDetails>) => Promise<void>;
  recoveryMode: boolean;
  clearRecovery: () => void;
  refreshProfile: () => Promise<void>;
  updateProfile: (patch: Partial<Profile>) => Promise<void>;
  updateSettings: (patch: Partial<UserSettings>) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const THEME_KEY = 'sauchatz-theme';

function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1115' : '#f6f8fb');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [details, setDetails] = useState<ProfileDetails | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const userId = session?.user.id ?? null;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
      setSession(s);
      if (!s) {
        setProfile(null);
        setSettings(null);
        setLoading(false);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    const [{ data: p }, { data: s }, { data: d }, { data: admin }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase.from('user_settings').select('user_id, theme, notify_desktop, notify_sound, enter_to_send, phone, layout').eq('user_id', userId).single(),
      supabase.from('profile_details').select('*').eq('user_id', userId).maybeSingle(),
      supabase.rpc('am_i_admin'),
    ]);
    setDetails((d as ProfileDetails | null) ?? { user_id: userId, birth_date: null, class_year: null, major: null, hometown: null, here_for: [], interests: [], prompts: [], hidden_fields: [] });
    setIsAdmin(Boolean(admin));
    if (p) {
      setProfile(p as Profile);
      cacheProfile(p as Profile);
    }
    if (s) setSettings(s as UserSettings);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    refreshProfile().finally(() => setLoading(false));
  }, [userId, refreshProfile]);

  // Theme: use the saved setting, fall back to the last one used on this device.
  // Layout (accent color, text size): apply whenever it or the theme changes.
  const layout = settings ? readLayout(settings.layout) : cachedLayout();
  const layoutNow = useRef(layout);
  layoutNow.current = layout;
  const layoutKey = JSON.stringify(layout);
  useEffect(() => { applyLayout(layoutNow.current); }, [layoutKey]);

  const theme: Theme = settings?.theme ?? ((localStorage.getItem(THEME_KEY) as Theme | null) || 'system');
  useEffect(() => {
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage unavailable */ }
    applyTheme(theme);
    applyLayout(layoutNow.current);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { applyTheme('system'); applyLayout(layoutNow.current); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const updateProfile = useCallback(async (patch: Partial<Profile>) => {
    if (!userId) return;
    const { data, error } = await supabase.from('profiles').update(patch).eq('id', userId).select().single();
    if (error) throw error;
    setProfile(data as Profile);
    cacheProfile(data as Profile);
  }, [userId]);

  const updateSettings = useCallback(async (patch: Partial<UserSettings>) => {
    if (!userId) return;
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    const { error } = await supabase.from('user_settings').update(patch).eq('user_id', userId);
    if (error) {
      await refreshProfile();
      throw error;
    }
  }, [userId, refreshProfile]);

  const updateDetails = useCallback(async (patch: Partial<ProfileDetails>) => {
    if (!userId) return;
    const { data, error } = await supabase.from('profile_details').update(patch).eq('user_id', userId).select().single();
    if (error) throw error;
    setDetails(data as ProfileDetails);
  }, [userId]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session, loading, profile, settings, details, isAdmin, updateDetails, recoveryMode,
        clearRecovery: () => setRecoveryMode(false),
        refreshProfile, updateProfile, updateSettings, signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** For screens that only render when signed in. */
export function useMe() {
  const { session, profile } = useAuth();
  if (!session || !profile) throw new Error('useMe used while signed out');
  const login = session.user.email ?? '';
  return { userId: session.user.id, email: login, profile };
}
