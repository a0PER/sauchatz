-- =====================================================================
-- Converse: database schema for Supabase
-- Run this whole file once in Supabase: SQL Editor > New query > Run.
-- It is safe to read top to bottom: tables, helpers, security rules,
-- functions the app calls, storage buckets, and realtime.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

-- Public profile for every user. Visible to all signed-in users.
create table public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  display_name         text not null check (char_length(display_name) between 1 and 60),
  description          text not null default '' check (char_length(description) <= 1000),
  avatar_url           text,
  status               text not null default 'active' check (status in ('active', 'away', 'dnd')),
  allow_messages_from  text not null default 'everyone' check (allow_messages_from in ('everyone', 'nobody')),
  show_read_receipts   boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index profiles_display_name_idx on public.profiles (lower(display_name));

-- Private settings, only readable by the owner.
create table public.user_settings (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  theme           text not null default 'system' check (theme in ('system', 'light', 'dark')),
  notify_desktop  boolean not null default true,
  notify_sound    boolean not null default true,
  enter_to_send   boolean not null default true,
  updated_at      timestamptz not null default now()
);

-- Photo gallery shown on each profile.
create table public.profile_photos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  storage_path  text not null,
  url           text not null,
  caption       text not null default '' check (char_length(caption) <= 300),
  created_at    timestamptz not null default now()
);
create index profile_photos_user_idx on public.profile_photos (user_id, created_at desc);

-- A conversation is either a direct message (2 people) or a group.
create table public.conversations (
  id               uuid primary key default gen_random_uuid(),
  type             text not null check (type in ('direct', 'group')),
  name             text check (name is null or char_length(name) between 1 and 80),
  description      text not null default '' check (char_length(description) <= 500),
  avatar_url       text,
  dm_key           text unique,  -- "smallerId:largerId" so two people only ever share one DM
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz not null default now(),
  check ((type = 'group' and name is not null) or (type = 'direct' and dm_key is not null))
);

create table public.conversation_members (
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  role             text not null default 'member' check (role in ('owner', 'admin', 'member')),
  muted            boolean not null default false,
  last_read_at     timestamptz not null default now(),
  joined_at        timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members (user_id);

create table public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  sender_id        uuid references public.profiles(id) on delete set null,
  body             text not null default '' check (char_length(body) <= 4000),
  image_path       text,
  created_at       timestamptz not null default now(),
  edited_at        timestamptz,
  deleted_at       timestamptz,
  check (body <> '' or image_path is not null or deleted_at is not null)
);
create index messages_conversation_idx on public.messages (conversation_id, created_at desc);

create table public.blocks (
  blocker_id  uuid not null references public.profiles(id) on delete cascade,
  blocked_id  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table public.reports (
  id                uuid primary key default gen_random_uuid(),
  reporter_id       uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  reported_user_id  uuid references public.profiles(id) on delete cascade,
  message_id        uuid references public.messages(id) on delete set null,
  reason            text not null check (char_length(reason) between 1 and 1000),
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. Helper functions used by the security rules
--    (security definer so they can look up membership without recursion)
-- ---------------------------------------------------------------------

create or replace function public.is_member(conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from conversation_members
    where conversation_id = conv and user_id = auth.uid()
  );
$$;

create or replace function public.is_group_admin(conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from conversation_members m
    join conversations c on c.id = m.conversation_id
    where m.conversation_id = conv and m.user_id = auth.uid()
      and m.role in ('owner', 'admin') and c.type = 'group'
  );
$$;

create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

-- True when the conversation is a DM and either person has blocked the other.
create or replace function public.dm_is_blocked(conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from conversations c
    join conversation_members other on other.conversation_id = c.id and other.user_id <> auth.uid()
    where c.id = conv and c.type = 'direct'
      and public.is_blocked_between(auth.uid(), other.user_id)
  );
$$;

-- ---------------------------------------------------------------------
-- 3. Triggers
-- ---------------------------------------------------------------------

-- Create the profile and settings rows when someone signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  v_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  if v_name is null then
    v_name := 'New member';  -- never derived from the email, which stays private
  end if;
  insert into public.profiles (id, display_name) values (new.id, left(v_name, 60));
  insert into public.user_settings (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep the conversation list ordered by latest activity.
create or replace function public.bump_conversation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update conversations set last_message_at = new.created_at where id = new.conversation_id;
  -- The sender has obviously read their own message.
  update conversation_members set last_read_at = new.created_at
  where conversation_id = new.conversation_id and user_id = new.sender_id;
  return new;
end;
$$;

create trigger on_message_inserted
  after insert on public.messages
  for each row execute function public.bump_conversation();

-- Editing and deleting messages: stamp edits, wipe content on delete.
create or replace function public.prepare_message_update()
returns trigger language plpgsql as $$
begin
  if old.deleted_at is not null then
    raise exception 'Deleted messages cannot be changed';
  end if;
  if new.deleted_at is not null then
    new.body := '';
    new.image_path := null;
  elsif new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

create trigger on_message_updating
  before update on public.messages
  for each row execute function public.prepare_message_update();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 4. Row level security
-- ---------------------------------------------------------------------

alter table public.profiles              enable row level security;
alter table public.user_settings         enable row level security;
alter table public.profile_photos        enable row level security;
alter table public.conversations         enable row level security;
alter table public.conversation_members  enable row level security;
alter table public.messages              enable row level security;
alter table public.blocks                enable row level security;
alter table public.reports               enable row level security;

-- Nobody who is signed out can read anything.
revoke all on all tables in schema public from anon;

-- profiles: everyone signed in can view; you can only edit your own.
create policy "profiles readable by signed-in users" on public.profiles
  for select to authenticated using (true);
create policy "edit own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke insert, update, delete on public.profiles from authenticated;
grant update (display_name, description, avatar_url, status, allow_messages_from, show_read_receipts)
  on public.profiles to authenticated;

-- user_settings: private.
create policy "read own settings" on public.user_settings
  for select to authenticated using (user_id = auth.uid());
create policy "edit own settings" on public.user_settings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke insert, update, delete on public.user_settings from authenticated;
grant update (theme, notify_desktop, notify_sound, enter_to_send) on public.user_settings to authenticated;

-- profile_photos: everyone signed in can view; you manage your own.
create policy "photos readable by signed-in users" on public.profile_photos
  for select to authenticated using (true);
create policy "add own photos" on public.profile_photos
  for insert to authenticated with check (user_id = auth.uid());
create policy "edit own photos" on public.profile_photos
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own photos" on public.profile_photos
  for delete to authenticated using (user_id = auth.uid());

-- conversations: members can view; group admins can edit details.
-- Creating conversations goes through the functions in section 5.
create policy "members view conversation" on public.conversations
  for select to authenticated using (public.is_member(id));
create policy "admins edit group" on public.conversations
  for update to authenticated using (public.is_group_admin(id)) with check (public.is_group_admin(id));
revoke insert, update, delete on public.conversations from authenticated;
grant update (name, description, avatar_url) on public.conversations to authenticated;

-- conversation_members: members see each other; you can only change
-- your own mute and read position. Adding, removing and roles go
-- through the functions in section 5.
create policy "members view members" on public.conversation_members
  for select to authenticated using (public.is_member(conversation_id));
create policy "update own membership" on public.conversation_members
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke insert, update, delete on public.conversation_members from authenticated;
grant update (muted, last_read_at) on public.conversation_members to authenticated;

-- messages: members read; members send (unless the DM is blocked);
-- you can edit or delete only your own.
create policy "members read messages" on public.messages
  for select to authenticated using (public.is_member(conversation_id));
create policy "members send messages" on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and public.is_member(conversation_id)
    and not public.dm_is_blocked(conversation_id)
    and edited_at is null and deleted_at is null
  );
create policy "edit own messages" on public.messages
  for update to authenticated using (sender_id = auth.uid()) with check (sender_id = auth.uid());
revoke update, delete on public.messages from authenticated;
grant update (body, deleted_at) on public.messages to authenticated;

-- blocks: private to the person blocking.
create policy "view own blocks" on public.blocks
  for select to authenticated using (blocker_id = auth.uid());
create policy "block someone" on public.blocks
  for insert to authenticated with check (blocker_id = auth.uid());
create policy "unblock someone" on public.blocks
  for delete to authenticated using (blocker_id = auth.uid());

-- reports: anyone signed in can file one; only admins (dashboard) read them.
create policy "file a report" on public.reports
  for insert to authenticated with check (reporter_id = auth.uid());

-- Explicit table permissions for signed-in users (newer Supabase projects
-- do not always grant these automatically). Row level security above still
-- decides which rows each person can see or change.
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant insert on public.profile_photos, public.messages, public.blocks, public.reports to authenticated;
grant update, delete on public.profile_photos to authenticated;
grant delete on public.blocks to authenticated;

-- ---------------------------------------------------------------------
-- 5. Functions the app calls (supabase.rpc)
-- ---------------------------------------------------------------------

-- Open (or create) a direct message with another person.
create or replace function public.get_or_create_direct(other_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  v_key text;
  v_id uuid;
  v_allow text;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if other_user = me then raise exception 'You cannot message yourself'; end if;

  select allow_messages_from into v_allow from profiles where id = other_user;
  if not found then raise exception 'User not found'; end if;
  if public.is_blocked_between(me, other_user) then
    raise exception 'You cannot message this person';
  end if;

  v_key := least(me::text, other_user::text) || ':' || greatest(me::text, other_user::text);
  select id into v_id from conversations where dm_key = v_key;
  if v_id is not null then return v_id; end if;

  if v_allow = 'nobody' then
    raise exception 'This person is not accepting new messages';
  end if;

  insert into conversations (type, dm_key, created_by) values ('direct', v_key, me)
  returning id into v_id;
  insert into conversation_members (conversation_id, user_id, role)
  values (v_id, me, 'member'), (v_id, other_user, 'member');
  return v_id;
end;
$$;

-- Create a group. The creator becomes the owner.
create or replace function public.create_group(p_name text, p_description text, p_member_ids uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  v_id uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Group name is required'; end if;

  insert into conversations (type, name, description, created_by)
  values ('group', trim(p_name), coalesce(trim(p_description), ''), me)
  returning id into v_id;

  insert into conversation_members (conversation_id, user_id, role) values (v_id, me, 'owner');
  insert into conversation_members (conversation_id, user_id, role)
  select v_id, p.id, 'member'
  from profiles p
  where p.id = any(coalesce(p_member_ids, '{}')) and p.id <> me
    and not public.is_blocked_between(me, p.id)
  on conflict do nothing;
  return v_id;
end;
$$;

-- Add people to a group (owners and admins).
create or replace function public.add_group_members(conv uuid, p_member_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_admin(conv) then raise exception 'Only group admins can add people'; end if;
  insert into conversation_members (conversation_id, user_id, role)
  select conv, p.id, 'member' from profiles p
  where p.id = any(coalesce(p_member_ids, '{}'))
    and not public.is_blocked_between(auth.uid(), p.id)
  on conflict do nothing;
end;
$$;

-- Remove someone from a group (owners and admins; the owner cannot be removed).
create or replace function public.remove_group_member(conv uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  my_role text;
begin
  if not public.is_group_admin(conv) then raise exception 'Only group admins can remove people'; end if;
  select role into v_role from conversation_members where conversation_id = conv and user_id = p_user;
  select role into my_role from conversation_members where conversation_id = conv and user_id = auth.uid();
  if v_role is null then return; end if;
  if v_role = 'owner' then raise exception 'The group owner cannot be removed'; end if;
  if v_role = 'admin' and my_role <> 'owner' then raise exception 'Only the owner can remove an admin'; end if;
  delete from conversation_members where conversation_id = conv and user_id = p_user;
end;
$$;

-- Make someone an admin or a regular member (owner only).
create or replace function public.set_member_role(conv uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_role not in ('admin', 'member') then raise exception 'Invalid role'; end if;
  if not exists (
    select 1 from conversation_members
    where conversation_id = conv and user_id = auth.uid() and role = 'owner'
  ) then
    raise exception 'Only the group owner can change roles';
  end if;
  update conversation_members set role = p_role
  where conversation_id = conv and user_id = p_user and role <> 'owner';
end;
$$;

-- Leave a group. If the owner leaves, ownership passes to the longest
-- serving admin (or member). The group is deleted when the last person leaves.
create or replace function public.leave_group(conv uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  v_role text;
  v_next uuid;
begin
  select m.role into v_role
  from conversation_members m join conversations c on c.id = m.conversation_id
  where m.conversation_id = conv and m.user_id = me and c.type = 'group';
  if v_role is null then raise exception 'You are not in this group'; end if;

  delete from conversation_members where conversation_id = conv and user_id = me;

  if v_role = 'owner' then
    select user_id into v_next from conversation_members
    where conversation_id = conv
    order by (role = 'admin') desc, joined_at asc
    limit 1;
    if v_next is null then
      delete from conversations where id = conv;
    else
      update conversation_members set role = 'owner' where conversation_id = conv and user_id = v_next;
    end if;
  end if;
end;
$$;

-- Delete a group entirely (owner only).
create or replace function public.delete_group(conv uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from conversation_members
    where conversation_id = conv and user_id = auth.uid() and role = 'owner'
  ) then
    raise exception 'Only the group owner can delete the group';
  end if;
  delete from conversations where id = conv and type = 'group';
end;
$$;

-- The sidebar list: every conversation I am in, newest first, with the
-- last message, my unread count and (for DMs) the other person.
create or replace function public.get_my_conversations()
returns table (
  id uuid,
  type text,
  name text,
  description text,
  avatar_url text,
  last_message_at timestamptz,
  muted boolean,
  unread_count bigint,
  member_count bigint,
  last_body text,
  last_has_image boolean,
  last_deleted boolean,
  last_sender_id uuid,
  last_sender_name text,
  other_user_id uuid,
  other_display_name text,
  other_avatar_url text,
  other_status text
)
language sql stable security invoker set search_path = public as $$
  select
    c.id, c.type, c.name, c.description, c.avatar_url, c.last_message_at, me.muted,
    (select count(*) from messages x
       where x.conversation_id = c.id and x.created_at > me.last_read_at
         and x.sender_id is distinct from auth.uid() and x.deleted_at is null) as unread_count,
    (select count(*) from conversation_members cm where cm.conversation_id = c.id) as member_count,
    lm.body, lm.image_path is not null, lm.deleted_at is not null, lm.sender_id, lp.display_name,
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

-- Permanently delete my account and everything attached to it.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
declare
  me uuid := auth.uid();
  g record;
begin
  if me is null then raise exception 'Not signed in'; end if;
  -- Hand over or close any groups I own first.
  for g in select conversation_id from conversation_members where user_id = me and role = 'owner' loop
    perform public.leave_group(g.conversation_id);
  end loop;
  delete from auth.users where id = me;
end;
$$;

revoke execute on all functions in schema public from anon, public;
grant execute on function
  public.get_or_create_direct(uuid),
  public.create_group(text, text, uuid[]),
  public.add_group_members(uuid, uuid[]),
  public.remove_group_member(uuid, uuid),
  public.set_member_role(uuid, uuid, text),
  public.leave_group(uuid),
  public.delete_group(uuid),
  public.get_my_conversations(),
  public.delete_my_account(),
  public.is_member(uuid),
  public.is_group_admin(uuid),
  public.is_blocked_between(uuid, uuid),
  public.dm_is_blocked(uuid)
to authenticated;

-- ---------------------------------------------------------------------
-- 6. Storage (pictures)
--    media        : public, profile pictures, gallery photos, group pictures
--    chat-images  : private, pictures sent in chats (members only)
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('media', 'media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('chat-images', 'chat-images', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

-- media/users/<my id>/...   and   media/groups/<group id>/...
create policy "upload own media" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'media' and (
      ((storage.foldername(name))[1] = 'users' and (storage.foldername(name))[2] = auth.uid()::text)
      or ((storage.foldername(name))[1] = 'groups' and public.is_group_admin(((storage.foldername(name))[2])::uuid))
    )
  );
create policy "delete own media" on storage.objects
  for delete to authenticated using (
    bucket_id = 'media' and (
      ((storage.foldername(name))[1] = 'users' and (storage.foldername(name))[2] = auth.uid()::text)
      or ((storage.foldername(name))[1] = 'groups' and public.is_group_admin(((storage.foldername(name))[2])::uuid))
    )
  );

-- chat-images/<conversation id>/...
create policy "members upload chat images" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'chat-images'
    and public.is_member(((storage.foldername(name))[1])::uuid)
    and not public.dm_is_blocked(((storage.foldername(name))[1])::uuid)
  );
create policy "members view chat images" on storage.objects
  for select to authenticated using (
    bucket_id = 'chat-images' and public.is_member(((storage.foldername(name))[1])::uuid)
  );

-- ---------------------------------------------------------------------
-- 7. Realtime (live updates)
-- ---------------------------------------------------------------------

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversation_members;
alter publication supabase_realtime add table public.conversations;
alter table public.messages replica identity full;

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

-- =====================================================================
-- 9. Version 3: email sign-in (with verification) and an optional, private phone number.
-- =====================================================================

alter table public.user_settings
  add column if not exists phone text check (phone is null or phone ~ '^[0-9]{10,15}$');
grant select (phone) on public.user_settings to authenticated;
grant update (phone) on public.user_settings to authenticated;

-- Save the optional phone number given at sign-up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_phone text;
begin
  v_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  if v_name is null then
    v_name := 'New member';
  end if;
  v_phone := nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone', ''), '[^0-9]', '', 'g'), '');
  if v_phone is not null and v_phone !~ '^[0-9]{10,15}$' then
    v_phone := null;
  end if;
  insert into public.profiles (id, display_name) values (new.id, left(v_name, 60))
  on conflict (id) do nothing;
  insert into public.user_settings (user_id, phone) values (new.id, v_phone)
  on conflict (user_id) do nothing;
  insert into public.profile_details (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Admin account list now shows email, phone and whether the email is verified.
drop function if exists public.admin_list_users();
create function public.admin_list_users()
returns table (
  id uuid, login text, phone text, email_confirmed boolean, display_name text, avatar_url text, is_public boolean,
  created_at timestamptz, last_sign_in_at timestamptz, message_count bigint, reports_against bigint, is_admin boolean
)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform public.require_admin();
  return query
  select u.id, u.email::text, s.phone, u.email_confirmed_at is not null, p.display_name, p.avatar_url, p.is_public,
    u.created_at, u.last_sign_in_at,
    (select count(*) from public.messages m where m.sender_id = u.id),
    (select count(*) from public.reports r where r.reported_user_id = u.id),
    exists (select 1 from public.admins a where a.user_id = u.id)
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join public.user_settings s on s.user_id = u.id
  order by u.created_at desc;
end;
$$;
revoke execute on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

-- =====================================================================
-- 10. Version 4: layout settings and per-item profile privacy
-- =====================================================================

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

-- =====================================================================
-- 11. Version 5: admin tools for test accounts only
-- =====================================================================

-- ---------- Mark test accounts (cannot be changed from the website) ----------
alter table public.profiles add column if not exists is_test boolean not null default false;
update public.profiles p set is_test = true
from auth.users u where u.id = p.id and u.email like '%@test.sauchatz.app';

create or replace function public.mark_test_profile()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  if exists (select 1 from auth.users u where u.id = new.id and u.email like '%@test.sauchatz.app') then
    new.is_test := true;
  end if;
  -- Test accounts always keep a name that starts with "Test".
  if new.is_test and new.display_name !~* '^test( |$)' then
    new.display_name := left('Test ' || new.display_name, 60);
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_mark_test on public.profiles;
create trigger profiles_mark_test before insert or update on public.profiles
  for each row execute function public.mark_test_profile();

create or replace function public.is_test_account(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_test from profiles where id = p_user), false);
$$;

-- ---------- Test account profiles ----------
create or replace function public.admin_list_test_accounts()
returns table (id uuid, login text, display_name text, description text, avatar_url text, is_public boolean, message_count bigint)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform public.require_admin();
  return query
  select p.id, u.email::text, p.display_name, p.description, p.avatar_url, p.is_public,
    (select count(*) from messages m where m.sender_id = p.id)
  from profiles p join auth.users u on u.id = p.id
  where p.is_test
  order by p.display_name;
end;
$$;

create or replace function public.admin_update_test_profile(p_user uuid, p_name text, p_description text, p_is_public boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if not public.is_test_account(p_user) then raise exception 'Only test accounts can be edited here'; end if;
  update profiles set display_name = left(trim(p_name), 60), description = left(coalesce(p_description, ''), 1000), is_public = p_is_public
  where id = p_user;
end;
$$;

-- ---------- Messages sent BY test accounts (never anyone else's) ----------
create or replace function public.admin_list_test_messages()
returns table (id uuid, conversation_id uuid, conversation_name text, sender_id uuid, sender_name text, body text, image_path text, created_at timestamptz, edited_at timestamptz, deleted_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin();
  return query
  select m.id, m.conversation_id,
    case when c.type = 'group' then c.name else 'Direct message' end,
    m.sender_id, p.display_name, m.body, m.image_path, m.created_at, m.edited_at, m.deleted_at
  from messages m
  join profiles p on p.id = m.sender_id and p.is_test
  join conversations c on c.id = m.conversation_id
  order by m.created_at desc
  limit 500;
end;
$$;

create or replace function public.admin_edit_test_message(p_message uuid, p_body text, p_delete boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_sender uuid;
begin
  perform public.require_admin();
  select sender_id into v_sender from messages where id = p_message;
  if v_sender is null or not public.is_test_account(v_sender) then
    raise exception 'Only messages sent by test accounts can be edited here';
  end if;
  if p_delete then
    update messages set deleted_at = now() where id = p_message;
  else
    if coalesce(trim(p_body), '') = '' then raise exception 'The message cannot be empty'; end if;
    update messages set body = left(p_body, 4000) where id = p_message;
  end if;
end;
$$;

revoke execute on function public.is_test_account(uuid), public.admin_list_test_accounts(),
  public.admin_update_test_profile(uuid, text, text, boolean), public.admin_list_test_messages(),
  public.admin_edit_test_message(uuid, text, boolean) from public, anon;
grant execute on function public.is_test_account(uuid), public.admin_list_test_accounts(),
  public.admin_update_test_profile(uuid, text, text, boolean), public.admin_list_test_messages(),
  public.admin_edit_test_message(uuid, text, boolean) to authenticated;

-- =====================================================================
-- 12. Version 6: invite links and adding private contacts
-- =====================================================================

-- ---------- Who can be added to a group ----------
-- Public profiles, or private profiles you already share a conversation with.
create or replace function public.can_add_to_group(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user <> auth.uid()
    and not public.is_blocked_between(auth.uid(), p_user)
    and (exists (select 1 from profiles where id = p_user and is_public) or public.shares_conversation(p_user));
$$;

create or replace function public.create_group(p_name text, p_description text, p_member_ids uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  v_id uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Group name is required'; end if;
  insert into conversations (type, name, description, created_by)
  values ('group', trim(p_name), coalesce(trim(p_description), ''), me)
  returning id into v_id;
  insert into conversation_members (conversation_id, user_id, role) values (v_id, me, 'owner');
  insert into conversation_members (conversation_id, user_id, role)
  select v_id, p.id, 'member' from profiles p
  where p.id = any(coalesce(p_member_ids, '{}')) and public.can_add_to_group(p.id)
  on conflict do nothing;
  return v_id;
end;
$$;

create or replace function public.add_group_members(conv uuid, p_member_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_admin(conv) then raise exception 'Only group admins can add people'; end if;
  insert into conversation_members (conversation_id, user_id, role)
  select conv, p.id, 'member' from profiles p
  where p.id = any(coalesce(p_member_ids, '{}')) and public.can_add_to_group(p.id)
  on conflict do nothing;
end;
$$;

-- People I can add who are private: everyone I already share a conversation with.
create or replace function public.my_private_contacts(p_term text default '')
returns setof public.profiles
language sql stable security definer set search_path = public as $$
  select distinct p.* from profiles p
  join conversation_members b on b.user_id = p.id
  join conversation_members a on a.conversation_id = b.conversation_id and a.user_id = auth.uid()
  where p.id <> auth.uid() and not p.is_public
    and (coalesce(p_term, '') = '' or p.display_name ilike '%' || replace(replace(p_term, '%', ''), '_', '') || '%')
    and not public.is_blocked_between(auth.uid(), p.id)
  order by p.display_name
  limit 40;
$$;

-- ---------- Invite links ----------
create table if not exists public.group_invites (
  code text primary key,
  conversation_id uuid not null unique references public.conversations(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.group_invites enable row level security;
revoke all on public.group_invites from anon, authenticated;

-- Get the group's link (creates one if needed). Owners and admins only.
create or replace function public.get_group_invite(conv uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  v_code text;
begin
  if not public.is_group_admin(conv) then raise exception 'Only group admins can share invite links'; end if;
  select code into v_code from group_invites where conversation_id = conv;
  if v_code is null then
    v_code := encode(extensions.gen_random_bytes(9), 'hex');
    insert into group_invites (code, conversation_id, created_by) values (v_code, conv, auth.uid());
  end if;
  return v_code;
end;
$$;

-- Make a new link; the old one stops working.
create or replace function public.reset_group_invite(conv uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_admin(conv) then raise exception 'Only group admins can reset invite links'; end if;
  delete from group_invites where conversation_id = conv;
  return public.get_group_invite(conv);
end;
$$;

-- Preview a link before joining.
create or replace function public.get_invite_info(p_code text)
returns table (conversation_id uuid, name text, description text, avatar_url text, member_count bigint, already_member boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.description, c.avatar_url,
    (select count(*) from conversation_members m where m.conversation_id = c.id),
    exists (select 1 from conversation_members m where m.conversation_id = c.id and m.user_id = auth.uid())
  from group_invites i join conversations c on c.id = i.conversation_id
  where i.code = p_code;
$$;

-- Join with a link.
create or replace function public.join_group_with_invite(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_conv uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select conversation_id into v_conv from group_invites where code = p_code;
  if v_conv is null then raise exception 'This invite link is not valid anymore'; end if;
  insert into conversation_members (conversation_id, user_id, role) values (v_conv, auth.uid(), 'member')
  on conflict do nothing;
  return v_conv;
end;
$$;

revoke execute on function public.can_add_to_group(uuid), public.my_private_contacts(text), public.get_group_invite(uuid),
  public.reset_group_invite(uuid), public.get_invite_info(text), public.join_group_with_invite(text) from public, anon;
grant execute on function public.can_add_to_group(uuid), public.my_private_contacts(text), public.get_group_invite(uuid),
  public.reset_group_invite(uuid), public.get_invite_info(text), public.join_group_with_invite(text) to authenticated;

-- =====================================================================
-- 13. Version 7: reactions, hearts, GIFs and private photos
-- =====================================================================

-- ---------- Messages: GIFs and private photos ----------
alter table public.messages add column if not exists gif_url text
  check (gif_url is null or gif_url ~ '^https://media[0-9]*\.giphy\.com/');
alter table public.messages add column if not exists recipient_id uuid references public.profiles(id) on delete cascade;

-- A message needs text, a picture or a GIF (unless deleted).
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.messages'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%image_path%' and pg_get_constraintdef(oid) like '%deleted_at%'
  loop
    execute format('alter table public.messages drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.messages add constraint messages_has_content
  check (body <> '' or image_path is not null or gif_url is not null or deleted_at is not null);

-- Private photos only in groups, only to another member, only for pictures.
alter table public.messages add constraint messages_private_photo
  check (recipient_id is null or (image_path is not null or deleted_at is not null));

-- Can I see this message? (members see everything except private photos meant for someone else)
create or replace function public.can_see_message(p_message uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from messages m
    where m.id = p_message and public.is_member(m.conversation_id)
      and (m.recipient_id is null or m.recipient_id = auth.uid() or m.sender_id = auth.uid())
  );
$$;

drop policy if exists "members read messages" on public.messages;
create policy "members read messages" on public.messages
  for select to authenticated using (
    public.is_member(conversation_id)
    and (recipient_id is null or recipient_id = auth.uid() or sender_id = auth.uid())
  );

drop policy if exists "members send messages" on public.messages;
create policy "members send messages" on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and public.is_member(conversation_id)
    and not public.dm_is_blocked(conversation_id)
    and edited_at is null and deleted_at is null
    and (recipient_id is null or (
      recipient_id <> auth.uid()
      and exists (select 1 from conversations c where c.id = conversation_id and c.type = 'group')
      and exists (select 1 from conversation_members m where m.conversation_id = messages.conversation_id and m.user_id = recipient_id)
    ))
  );

-- Private photo files live in <conversation>/private/<recipient>/<sender>/...
drop policy if exists "members view chat images" on storage.objects;
create policy "members view chat images" on storage.objects
  for select to authenticated using (
    bucket_id = 'chat-images'
    and public.is_member(((storage.foldername(name))[1])::uuid)
    and (
      (storage.foldername(name))[2] is distinct from 'private'
      or auth.uid()::text in ((storage.foldername(name))[3], (storage.foldername(name))[4])
    )
  );
drop policy if exists "members upload chat images" on storage.objects;
create policy "members upload chat images" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'chat-images'
    and public.is_member(((storage.foldername(name))[1])::uuid)
    and not public.dm_is_blocked(((storage.foldername(name))[1])::uuid)
    and ((storage.foldername(name))[2] is distinct from 'private' or (storage.foldername(name))[4] = auth.uid()::text)
  );

-- ---------- Reactions ----------
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index if not exists message_reactions_conv_idx on public.message_reactions (conversation_id);
alter table public.message_reactions enable row level security;
alter table public.message_reactions replica identity full;
revoke all on public.message_reactions from anon;
grant select, insert, delete on public.message_reactions to authenticated;

create policy "see reactions on visible messages" on public.message_reactions
  for select to authenticated using (public.can_see_message(message_id));
create policy "react to visible messages" on public.message_reactions
  for insert to authenticated with check (
    user_id = auth.uid() and public.can_see_message(message_id)
    and conversation_id = (select m.conversation_id from messages m where m.id = message_id)
    and (select count(*) from message_reactions r where r.message_id = message_reactions.message_id and r.user_id = auth.uid()) < 6
  );
create policy "remove own reactions" on public.message_reactions
  for delete to authenticated using (user_id = auth.uid());

-- ---------- Hearts ----------
alter table public.profiles add column if not exists show_hearts boolean not null default true;
grant update (show_hearts) on public.profiles to authenticated;

create table if not exists public.profile_hearts (
  from_user uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  to_user uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_user, to_user),
  check (from_user <> to_user)
);
alter table public.profile_hearts enable row level security;
revoke all on public.profile_hearts from anon;
grant select, insert, delete on public.profile_hearts to authenticated;
create policy "see hearts I sent" on public.profile_hearts
  for select to authenticated using (from_user = auth.uid());
create policy "send a heart" on public.profile_hearts
  for insert to authenticated with check (
    from_user = auth.uid() and not public.is_blocked_between(auth.uid(), to_user)
  );
create policy "take back a heart" on public.profile_hearts
  for delete to authenticated using (from_user = auth.uid());

-- Heart count for a profile. Hidden from others when the owner turns it off.
create or replace function public.heart_count(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select case
    when p_user = auth.uid() or coalesce((select show_hearts from profiles where id = p_user), true)
    then (select count(*)::int from profile_hearts where to_user = p_user)
    else null end;
$$;

-- Add new tables to live updates.
do $$
begin
  begin
    alter publication supabase_realtime add table public.message_reactions;
  exception when duplicate_object then null;
  end;
end $$;

revoke execute on function public.can_see_message(uuid), public.heart_count(uuid) from public, anon;
grant execute on function public.can_see_message(uuid), public.heart_count(uuid) to authenticated;

-- Sidebar list: show 'GIF' as the preview for GIF messages.
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
    case when me.locked then null else coalesce(nullif(lm.body, ''), case when lm.gif_url is not null then 'GIF' end) end,
    case when me.locked then false else lm.image_path is not null end,
    lm.deleted_at is not null,
    case when me.locked then null else lm.sender_id end,
    case when me.locked then null else lp.display_name end,
    op.id, op.display_name, op.avatar_url, op.status
  from conversation_members me
  join conversations c on c.id = me.conversation_id
  left join lateral (
    select m.body, m.image_path, m.gif_url, m.deleted_at, m.sender_id from messages m
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
revoke execute on function public.get_my_conversations() from public, anon;
grant execute on function public.get_my_conversations() to authenticated;

-- =========================================================
-- 14. Private photo previews (same as upgrade-008.sql)
-- =========================================================

-- A tiny, already blurred preview (about 1 KB) saved with the message.
alter table public.messages add column if not exists image_blur text;
alter table public.messages drop constraint if exists messages_image_blur;
alter table public.messages add constraint messages_image_blur
  check (image_blur is null or (image_blur like 'data:image/%;base64,%' and char_length(image_blur) <= 6000));

-- Private photos carry no caption, because everyone in the group can now see the message row.
update public.messages set body = '' where recipient_id is not null and body <> '';
alter table public.messages drop constraint if exists messages_private_no_caption;
alter table public.messages add constraint messages_private_no_caption
  check (recipient_id is null or body = '');

-- Every member can see every message; only the photo file itself is private.
create or replace function public.can_see_message(p_message uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from messages m
    where m.id = p_message and public.is_member(m.conversation_id)
  );
$$;

drop policy if exists "members read messages" on public.messages;
create policy "members read messages" on public.messages
  for select to authenticated using (public.is_member(conversation_id));

-- Deleting a message also clears the preview.
create or replace function public.prepare_message_update()
returns trigger language plpgsql as $$
begin
  if old.deleted_at is not null then
    raise exception 'Deleted messages cannot be changed';
  end if;
  if new.deleted_at is not null then
    new.body := '';
    new.image_path := null;
    new.image_blur := null;
  elsif new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end;
$$;
