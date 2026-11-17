-- Version 4: layout settings and per-item profile privacy.
-- Run once in Supabase SQL Editor, after upgrade-003.sql.

-- ---------- Layout settings (saved per account) ----------
alter table public.user_settings add column if not exists layout jsonb not null default '{}'::jsonb;
grant select (layout) on public.user_settings to authenticated;
grant update (layout) on public.user_settings to authenticated;

-- ---------- Per-item profile privacy ----------
-- Items listed here are visible only to the owner:
-- age, class_year, major, hometown, here_for, interests, prompts, photos
alter table public.profile_details add column if not exists hidden_fields text[] not null default '{}'
  check (hidden_fields <@ array['age','class_year','major','hometown','here_for','interests','prompts','photos']);

-- Only the owner reads their own details row directly (it holds the exact birthday).
drop policy if exists "details visible per profile privacy" on public.profile_details;
drop policy if exists "read own details" on public.profile_details;
create policy "read own details" on public.profile_details
  for select to authenticated using (user_id = auth.uid());

-- Everyone else gets this view of a profile: age instead of birthday, hidden items removed.
create or replace function public.get_profile_details(p_user uuid)
returns table (
  user_id uuid, age int, class_year text, major text, hometown text,
  here_for text[], interests text[], prompts jsonb, hidden_fields text[]
)
language sql stable security definer set search_path = public as $$
  select d.user_id,
    case when 'age' = any(d.hidden_fields) or d.birth_date is null then null
         else extract(year from age(current_date, d.birth_date))::int end,
    case when 'class_year' = any(d.hidden_fields) then null else d.class_year end,
    case when 'major' = any(d.hidden_fields) then null else d.major end,
    case when 'hometown' = any(d.hidden_fields) then null else d.hometown end,
    case when 'here_for' = any(d.hidden_fields) then '{}'::text[] else d.here_for end,
    case when 'interests' = any(d.hidden_fields) then '{}'::text[] else d.interests end,
    case when 'prompts' = any(d.hidden_fields) then '[]'::jsonb else d.prompts end,
    case when d.user_id = auth.uid() then d.hidden_fields else '{}'::text[] end
  from profile_details d
  where d.user_id = p_user and public.can_view_profile(p_user);
$$;

-- Gallery photos follow the "photos" setting.
create or replace function public.photos_hidden(owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profile_details d where d.user_id = owner and 'photos' = any(d.hidden_fields));
$$;
drop policy if exists "photos visible per profile privacy" on public.profile_photos;
create policy "photos visible per profile privacy" on public.profile_photos
  for select to authenticated using (
    user_id = auth.uid()
    or (public.can_view_profile(user_id) and not public.photos_hidden(user_id))
  );

revoke execute on function public.get_profile_details(uuid), public.photos_hidden(uuid) from public, anon;
grant execute on function public.get_profile_details(uuid), public.photos_hidden(uuid) to authenticated;
