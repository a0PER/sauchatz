-- Version 6: invite links for groups, and adding private profiles you already chat with.
-- Run once in Supabase SQL Editor, after upgrade-005.sql.

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
