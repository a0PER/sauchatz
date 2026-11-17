-- Run this once in Supabase SQL Editor to upgrade an existing Sauchatz database.
-- =====================================================================
-- 8. Version 2: phone sign-in, public profiles, dating-style details,
--    chat PIN lock and admin tools.
--    (Also shipped as supabase/upgrade-002.sql for existing databases.)
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- New accounts never take a name from their login.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  v_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  if v_name is null then
    v_name := 'New member';
  end if;
  insert into public.profiles (id, display_name) values (new.id, left(v_name, 60))
  on conflict (id) do nothing;
  insert into public.user_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;
  insert into public.profile_details (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- ---------- Public or private profiles ----------
alter table public.profiles add column if not exists is_public boolean not null default true;
grant update (is_public) on public.profiles to authenticated;

-- True when I share any conversation with this person.
create or replace function public.shares_conversation(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from conversation_members a
    join conversation_members b on b.conversation_id = a.conversation_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

-- Who may see a person's photos and profile details.
create or replace function public.can_view_profile(owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select owner = auth.uid()
    or exists (select 1 from profiles where id = owner and is_public)
    or public.shares_conversation(owner);
$$;

drop policy if exists "photos readable by signed-in users" on public.profile_photos;
create policy "photos visible per profile privacy" on public.profile_photos
  for select to authenticated using (public.can_view_profile(user_id));

-- ---------- Dating-style profile details ----------
create table if not exists public.profile_details (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  birth_date   date check (birth_date is null or birth_date <= (current_date - interval '18 years')),
  class_year   text check (class_year is null or class_year in ('Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate', 'Other')),
  major        text check (major is null or char_length(major) <= 80),
  hometown     text check (hometown is null or char_length(hometown) <= 80),
  here_for     text[] not null default '{}' check (cardinality(here_for) <= 6),
  interests    text[] not null default '{}' check (cardinality(interests) <= 12),
  prompts      jsonb not null default '[]'::jsonb check (jsonb_typeof(prompts) = 'array' and jsonb_array_length(prompts) <= 3),
  updated_at   timestamptz not null default now()
);
insert into public.profile_details (user_id) select id from public.profiles on conflict do nothing;

alter table public.profile_details enable row level security;
create policy "details visible per profile privacy" on public.profile_details
  for select to authenticated using (public.can_view_profile(user_id));
create policy "edit own details" on public.profile_details
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.profile_details from anon;
grant select, update on public.profile_details to authenticated;
create trigger details_touch before update on public.profile_details
  for each row execute function public.touch_updated_at();

-- ---------- Chat PIN lock ----------
alter table public.user_settings
  add column if not exists chat_pin_hash text,
  add column if not exists pin_failed_attempts int not null default 0,
  add column if not exists pin_locked_until timestamptz;
alter table public.conversation_members add column if not exists locked boolean not null default false;

-- The PIN hash is never readable from the website, even by its owner.
revoke select on public.user_settings from authenticated;
grant select (user_id, theme, notify_desktop, notify_sound, enter_to_send, updated_at) on public.user_settings to authenticated;

create or replace function public.pin_status()
returns table (has_pin boolean, locked_until timestamptz)
language sql stable security definer set search_path = public as $$
  select chat_pin_hash is not null, case when pin_locked_until > now() then pin_locked_until end
  from user_settings where user_id = auth.uid();
$$;

-- Checks a PIN. After 5 wrong tries the PIN is frozen for 5 minutes.
create or replace function public.check_my_pin(p_pin text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare
  s record;
begin
  select chat_pin_hash, pin_failed_attempts, pin_locked_until into s
  from user_settings where user_id = auth.uid() for update;
  if s.chat_pin_hash is null then return false; end if;
  if s.pin_locked_until is not null and s.pin_locked_until > now() then return false; end if;
  if extensions.crypt(coalesce(p_pin, ''), s.chat_pin_hash) = s.chat_pin_hash then
    update user_settings set pin_failed_attempts = 0, pin_locked_until = null where user_id = auth.uid();
    return true;
  end if;
  update user_settings
  set pin_failed_attempts = case when s.pin_failed_attempts + 1 >= 5 then 0 else s.pin_failed_attempts + 1 end,
      pin_locked_until = case when s.pin_failed_attempts + 1 >= 5 then now() + interval '5 minutes' else null end
  where user_id = auth.uid();
  return false;
end;
$$;

create or replace function public.verify_chat_pin(p_pin text)
returns boolean language sql security definer set search_path = public as $$
  select public.check_my_pin(p_pin);
$$;

-- Set a new PIN (4 to 6 digits). Changing an existing PIN needs the current one.
create or replace function public.set_chat_pin(p_new text, p_current text default null)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare
  v_has boolean;
begin
  if p_new !~ '^[0-9]{4,6}$' then raise exception 'The PIN must be 4 to 6 digits'; end if;
  select chat_pin_hash is not null into v_has from user_settings where user_id = auth.uid();
  if v_has and not public.check_my_pin(p_current) then return false; end if;
  update user_settings
  set chat_pin_hash = extensions.crypt(p_new, extensions.gen_salt('bf')), pin_failed_attempts = 0, pin_locked_until = null
  where user_id = auth.uid();
  return true;
end;
$$;

-- Lock a chat (needs a PIN to exist) or unlock it (needs the correct PIN).
create or replace function public.set_chat_locked(conv uuid, p_locked boolean, p_pin text default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(conv) then raise exception 'You are not in this conversation'; end if;
  if p_locked then
    if not exists (select 1 from user_settings where user_id = auth.uid() and chat_pin_hash is not null) then
      raise exception 'Set a chat PIN first';
    end if;
  elsif not public.check_my_pin(p_pin) then
    return false;
  end if;
  update conversation_members set locked = p_locked where conversation_id = conv and user_id = auth.uid();
  return true;
end;
$$;

-- Forgot the PIN: allowed only right after re-entering the account password.
-- Removes the PIN and unlocks all chats.
create or replace function public.reset_chat_pin()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a
    where (a ->> 'timestamp')::bigint > extract(epoch from now())::bigint - 600
  ) then
    raise exception 'Please confirm your password first';
  end if;
  update user_settings set chat_pin_hash = null, pin_failed_attempts = 0, pin_locked_until = null where user_id = auth.uid();
  update conversation_members set locked = false where user_id = auth.uid();
end;
$$;

-- Sidebar list, now with lock state. Locked chats never return a preview.
drop function if exists public.get_my_conversations();
create function public.get_my_conversations()
returns table (
  id uuid, type text, name text, description text, avatar_url text, last_message_at timestamptz,
  muted boolean, locked boolean, unread_count bigint, member_count bigint,
  last_body text, last_has_image boolean, last_deleted boolean, last_sender_id uuid, last_sender_name text,
  other_user_id uuid, other_display_name text, other_avatar_url text, other_status text
)
language sql stable security invoker set search_path = public as $$
  select
    c.id, c.type, c.name, c.description, c.avatar_url, c.last_message_at, me.muted, me.locked,
    (select count(*) from messages x
       where x.conversation_id = c.id and x.created_at > me.last_read_at
         and x.sender_id is distinct from auth.uid() and x.deleted_at is null),
    (select count(*) from conversation_members cm where cm.conversation_id = c.id),
    case when me.locked then null else lm.body end,
    case when me.locked then false else lm.image_path is not null end,
    lm.deleted_at is not null,
    case when me.locked then null else lm.sender_id end,
    case when me.locked then null else lp.display_name end,
    op.id, op.display_name, op.avatar_url, op.status
  from conversation_members me
  join conversations c on c.id = me.conversation_id
  left join lateral (
    select m.body, m.image_path, m.deleted_at, m.sender_id from messages m
    where m.conversation_id = c.id order by m.created_at desc limit 1
  ) lm on true
  left join profiles lp on lp.id = lm.sender_id
  left join lateral (
    select p.* from conversation_members o join profiles p on p.id = o.user_id
    where c.type = 'direct' and o.conversation_id = c.id and o.user_id <> auth.uid()
    limit 1
  ) op on true
  where me.user_id = auth.uid()
  order by c.last_message_at desc;
$$;

-- ---------- Admin tools ----------
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

create or replace function public.am_i_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

create or replace function public.require_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.am_i_admin() then raise exception 'Admins only'; end if;
end;
$$;

-- Every account. The login is the phone number; passwords are never readable.
drop function if exists public.admin_list_users();
create function public.admin_list_users()
returns table (
  id uuid, login text, display_name text, avatar_url text, is_public boolean,
  created_at timestamptz, last_sign_in_at timestamptz, message_count bigint, reports_against bigint, is_admin boolean
)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform public.require_admin();
  return query
  select u.id, u.email::text, p.display_name, p.avatar_url, p.is_public, u.created_at, u.last_sign_in_at,
    (select count(*) from public.messages m where m.sender_id = u.id),
    (select count(*) from public.reports r where r.reported_user_id = u.id),
    exists (select 1 from public.admins a where a.user_id = u.id)
  from auth.users u
  left join public.profiles p on p.id = u.id
  order by u.created_at desc;
end;
$$;

create or replace function public.admin_delete_user(p_user uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
declare
  g record;
begin
  perform public.require_admin();
  if p_user = auth.uid() then raise exception 'Use Settings to delete your own account'; end if;
  -- Hand over groups this person owns, then delete the account and everything it owns.
  for g in select conversation_id from conversation_members where user_id = p_user and role = 'owner' loop
    delete from conversation_members where conversation_id = g.conversation_id and user_id = p_user;
    update conversation_members set role = 'owner'
    where conversation_id = g.conversation_id
      and user_id = (select user_id from conversation_members where conversation_id = g.conversation_id
                     order by (role = 'admin') desc, joined_at limit 1);
    delete from conversations c where c.id = g.conversation_id
      and not exists (select 1 from conversation_members m where m.conversation_id = c.id);
  end loop;
  delete from auth.users where id = p_user;
end;
$$;

-- Give someone a new password (there is no self-service reset).
create or replace function public.admin_set_password(p_user uuid, p_password text)
returns void language plpgsql security definer set search_path = public, auth, extensions as $$
begin
  perform public.require_admin();
  if char_length(coalesce(p_password, '')) < 8 then raise exception 'Use at least 8 characters'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
  where id = p_user;
end;
$$;

-- Reports, with the reported message so moderators can judge it.
create or replace function public.admin_list_reports()
returns table (
  id uuid, created_at timestamptz, reason text,
  reporter_id uuid, reporter_name text, reported_user_id uuid, reported_name text,
  message_id uuid, message_body text, message_image text, message_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin();
  return query
  select r.id, r.created_at, r.reason, r.reporter_id, rp.display_name, r.reported_user_id, tp.display_name,
         r.message_id, m.body, m.image_path, m.created_at
  from reports r
  left join profiles rp on rp.id = r.reporter_id
  left join profiles tp on tp.id = r.reported_user_id
  left join messages m on m.id = r.message_id
  order by r.created_at desc;
end;
$$;

create or replace function public.admin_dismiss_report(p_report uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  delete from reports where id = p_report;
end;
$$;

revoke execute on function
  public.shares_conversation(uuid), public.can_view_profile(uuid), public.pin_status(), public.check_my_pin(text),
  public.verify_chat_pin(text), public.set_chat_pin(text, text), public.set_chat_locked(uuid, boolean, text),
  public.reset_chat_pin(), public.get_my_conversations(), public.am_i_admin(), public.require_admin(),
  public.admin_list_users(), public.admin_delete_user(uuid), public.admin_set_password(uuid, text),
  public.admin_list_reports(), public.admin_dismiss_report(uuid)
from public, anon;
grant execute on function
  public.shares_conversation(uuid), public.can_view_profile(uuid), public.pin_status(),
  public.verify_chat_pin(text), public.set_chat_pin(text, text), public.set_chat_locked(uuid, boolean, text),
  public.reset_chat_pin(), public.get_my_conversations(), public.am_i_admin(),
  public.admin_list_users(), public.admin_delete_user(uuid), public.admin_set_password(uuid, text),
  public.admin_list_reports(), public.admin_dismiss_report(uuid)
to authenticated;
-- check_my_pin and require_admin are internal helpers only.
