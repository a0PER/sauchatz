-- Version 13: "Name joined the chat" lines in group chats.
-- Run once in Supabase SQL Editor, after upgrade-012.sql.

-- 'text' for normal messages, 'joined' for the automatic join line.
alter table public.messages add column if not exists kind text not null default 'text';
alter table public.messages drop constraint if exists messages_kind;
alter table public.messages add constraint messages_kind check (kind in ('text', 'joined'));

-- Join lines have no text of their own (the name is filled in when shown, so renames carry over).
alter table public.messages drop constraint if exists messages_has_content;
alter table public.messages add constraint messages_has_content
  check (kind <> 'text' or body <> '' or image_path is not null or gif_url is not null or deleted_at is not null);

-- People can only send normal messages; join lines come from the database itself.
drop policy if exists "members send messages" on public.messages;
create policy "members send messages" on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and kind = 'text'
    and public.is_member(conversation_id)
    and not public.dm_is_blocked(conversation_id)
    and edited_at is null and deleted_at is null
    and (recipient_id is null or (
      recipient_id <> auth.uid()
      and exists (select 1 from conversations c where c.id = conversation_id and c.type = 'group')
      and exists (select 1 from conversation_members m where m.conversation_id = messages.conversation_id and m.user_id = recipient_id)
    ))
  );

-- Join lines cannot be edited or deleted by members.
create or replace function public.prepare_message_update()
returns trigger language plpgsql as $$
begin
  if old.kind <> 'text' then
    if new.body is distinct from old.body or new.deleted_at is distinct from old.deleted_at then
      raise exception 'This message cannot be changed';
    end if;
    return new;
  end if;
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

-- When someone joins a group after it was created, post "Name joined the chat".
create or replace function public.post_join_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from conversations c
    where c.id = new.conversation_id and c.type = 'group' and c.created_at < now()
  ) then
    insert into messages (conversation_id, sender_id, body, kind)
    values (new.conversation_id, new.user_id, '', 'joined');
  end if;
  return new;
end;
$$;
drop trigger if exists on_member_joined on public.conversation_members;
create trigger on_member_joined
  after insert on public.conversation_members
  for each row execute function public.post_join_message();

-- Sidebar: show "Name joined the chat" as the preview, and do not count join lines as unread.
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
       where x.conversation_id = c.id and x.created_at > me.last_read_at and x.kind = 'text'
         and x.sender_id is distinct from auth.uid() and x.deleted_at is null),
    (select count(*) from conversation_members cm where cm.conversation_id = c.id),
    case
      when me.locked then null
      when lm.kind = 'joined' then coalesce(lp.display_name, 'Someone') || ' joined the chat'
      else coalesce(nullif(lm.body, ''), case when lm.gif_url is not null then 'GIF' end)
    end,
    case when me.locked then false else lm.image_path is not null end,
    lm.deleted_at is not null,
    case when me.locked or lm.kind <> 'text' then null else lm.sender_id end,
    case when me.locked or lm.kind <> 'text' then null else lp.display_name end,
    op.id, op.display_name, op.avatar_url, op.status
  from conversation_members me
  join conversations c on c.id = me.conversation_id
  left join lateral (
    select m.body, m.image_path, m.gif_url, m.deleted_at, m.sender_id, m.kind from messages m
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

notify pgrst, 'reload schema';
