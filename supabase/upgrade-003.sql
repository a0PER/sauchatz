-- Version 3: email sign-in (with verification) and an optional, private phone number.
-- Run once in Supabase SQL Editor, after upgrade-002.sql.

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
