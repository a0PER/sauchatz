-- Version 11: admins can fully edit anyone's profile (name, status, privacy, photos, details).
-- Run once in Supabase SQL Editor, after upgrade-010.sql.

-- Everything about one profile, for the admin editor.
create or replace function public.admin_get_profile(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  perform public.require_admin();
  select jsonb_build_object(
    'profile', to_jsonb(p),
    'details', (select to_jsonb(d) from profile_details d where d.user_id = p.id),
    'photos', coalesce((select jsonb_agg(to_jsonb(ph) order by ph.created_at) from profile_photos ph where ph.user_id = p.id), '[]'::jsonb)
  ) into result
  from profiles p where p.id = p_user;
  if result is null then raise exception 'Account not found'; end if;
  return result;
end;
$$;

-- Save profile and detail changes. Only the keys that are sent are changed.
create or replace function public.admin_update_profile(p_user uuid, p_profile jsonb default '{}'::jsonb, p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  p_profile := coalesce(p_profile, '{}'::jsonb);
  p_details := coalesce(p_details, '{}'::jsonb);

  if p_profile ? 'display_name' and char_length(trim(coalesce(p_profile ->> 'display_name', ''))) not between 1 and 60 then
    raise exception 'Names must be 1 to 60 characters';
  end if;

  update profiles set
    display_name = case when p_profile ? 'display_name' then trim(p_profile ->> 'display_name') else display_name end,
    description  = case when p_profile ? 'description' then coalesce(p_profile ->> 'description', '') else description end,
    avatar_url   = case when p_profile ? 'avatar_url' then nullif(p_profile ->> 'avatar_url', '') else avatar_url end,
    status       = case when p_profile ? 'status' then p_profile ->> 'status' else status end,
    is_public    = case when p_profile ? 'is_public' then (p_profile ->> 'is_public')::boolean else is_public end,
    show_hearts  = case when p_profile ? 'show_hearts' then (p_profile ->> 'show_hearts')::boolean else show_hearts end,
    name_locked  = case when p_profile ? 'name_locked' then (p_profile ->> 'name_locked')::boolean else name_locked end
  where id = p_user;
  if not found then raise exception 'Account not found'; end if;

  if p_details <> '{}'::jsonb then
    insert into profile_details (user_id) values (p_user) on conflict do nothing;
    update profile_details set
      birth_date    = case when p_details ? 'birth_date' then nullif(p_details ->> 'birth_date', '')::date else birth_date end,
      class_year    = case when p_details ? 'class_year' then nullif(p_details ->> 'class_year', '') else class_year end,
      major         = case when p_details ? 'major' then nullif(trim(p_details ->> 'major'), '') else major end,
      hometown      = case when p_details ? 'hometown' then nullif(trim(p_details ->> 'hometown'), '') else hometown end,
      here_for      = case when p_details ? 'here_for' then array(select jsonb_array_elements_text(p_details -> 'here_for')) else here_for end,
      interests     = case when p_details ? 'interests' then array(select jsonb_array_elements_text(p_details -> 'interests')) else interests end,
      prompts       = case when p_details ? 'prompts' then p_details -> 'prompts' else prompts end,
      hidden_fields = case when p_details ? 'hidden_fields' then array(select jsonb_array_elements_text(p_details -> 'hidden_fields')) else hidden_fields end
    where user_id = p_user;
  end if;
end;
$$;

revoke execute on function public.admin_get_profile(uuid), public.admin_update_profile(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.admin_get_profile(uuid), public.admin_update_profile(uuid, jsonb, jsonb) to authenticated;

-- Admins can add, caption and remove anyone's profile photos.
drop policy if exists "admins see all photos" on public.profile_photos;
create policy "admins see all photos" on public.profile_photos
  for select to authenticated using (public.am_i_admin());
drop policy if exists "admins add photos" on public.profile_photos;
create policy "admins add photos" on public.profile_photos
  for insert to authenticated with check (public.am_i_admin());
drop policy if exists "admins edit photos" on public.profile_photos;
create policy "admins edit photos" on public.profile_photos
  for update to authenticated using (public.am_i_admin()) with check (public.am_i_admin());
drop policy if exists "admins delete photos" on public.profile_photos;
create policy "admins delete photos" on public.profile_photos
  for delete to authenticated using (public.am_i_admin());

-- Admins can upload and remove pictures in anyone's profile folder.
drop policy if exists "admins upload profile media" on storage.objects;
create policy "admins upload profile media" on storage.objects
  for insert to authenticated with check (bucket_id = 'media' and (storage.foldername(name))[1] = 'users' and public.am_i_admin());
drop policy if exists "admins delete profile media" on storage.objects;
create policy "admins delete profile media" on storage.objects
  for delete to authenticated using (bucket_id = 'media' and (storage.foldername(name))[1] = 'users' and public.am_i_admin());

-- Make the new functions available to the website right away.
notify pgrst, 'reload schema';
