-- Version 5: admin tools for TEST accounts only (emails ending in @test.sauchatz.app).
-- Run once in Supabase SQL Editor, after upgrade-004.sql.

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
