-- Version 7: reactions, hearts, GIFs and private photos in groups.
-- Run once in Supabase SQL Editor, after upgrade-006.sql.

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
