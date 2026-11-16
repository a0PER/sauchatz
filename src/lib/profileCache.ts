import { supabase } from './supabase';
import type { Profile } from './types';

// Small in-memory cache so names and avatars are not refetched constantly.
const cache = new Map<string, Profile>();

export function cacheProfile(p: Profile) {
  cache.set(p.id, p);
}

export function cachedProfile(id: string) {
  return cache.get(id);
}

export async function getProfiles(ids: string[]): Promise<Map<string, Profile>> {
  const missing = [...new Set(ids)].filter((id) => id && !cache.has(id));
  if (missing.length) {
    const { data } = await supabase.from('profiles').select('*').in('id', missing);
    (data as Profile[] | null)?.forEach(cacheProfile);
  }
  const out = new Map<string, Profile>();
  ids.forEach((id) => {
    const p = cache.get(id);
    if (p) out.set(id, p);
  });
  return out;
}

export async function getProfile(id: string): Promise<Profile | null> {
  const map = await getProfiles([id]);
  return map.get(id) ?? null;
}
