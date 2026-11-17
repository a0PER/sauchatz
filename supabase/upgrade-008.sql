-- Version 8: private photos in groups show a blurred preview to everyone else.
-- Run once in Supabase SQL Editor, after upgrade-007.sql.
-- The real photo file stays locked to the sender and the recipient (storage policy from version 7).

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
