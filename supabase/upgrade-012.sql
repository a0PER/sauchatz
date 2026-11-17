-- Version 12: site admins can add people with private profiles to group chats.
-- Run once in Supabase SQL Editor, after upgrade-011.sql.

-- Who can be added to a group: public profiles, private profiles you already chat with,
-- and anyone at all when a site admin is adding them.
create or replace function public.can_add_to_group(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user <> auth.uid()
    and not public.is_blocked_between(auth.uid(), p_user)
    and (
      public.am_i_admin()
      or exists (select 1 from profiles where id = p_user and is_public)
      or public.shares_conversation(p_user)
    );
$$;

-- Site admins can add people to any group they are in, even if they are not a group admin there.
create or replace function public.add_group_members(conv uuid, p_member_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_group_admin(conv) or (public.am_i_admin() and public.is_member(conv))) then
    raise exception 'Only group admins can add people';
  end if;
  insert into conversation_members (conversation_id, user_id, role)
  select conv, p.id, 'member' from profiles p
  where p.id = any(coalesce(p_member_ids, '{}')) and public.can_add_to_group(p.id)
  on conflict do nothing;
end;
$$;

-- Private people shown when adding to a group. Site admins see every private profile.
create or replace function public.my_private_contacts(p_term text default '')
returns setof public.profiles
language sql stable security definer set search_path = public as $$
  select distinct p.* from profiles p
  where p.id <> auth.uid() and not p.is_public
    and (coalesce(p_term, '') = '' or p.display_name ilike '%' || replace(replace(p_term, '%', ''), '_', '') || '%')
    and not public.is_blocked_between(auth.uid(), p.id)
    and (public.am_i_admin() or public.shares_conversation(p.id))
  order by p.display_name
  limit 40;
$$;

notify pgrst, 'reload schema';
