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
