-- Version 9: optional email verification shown on profiles, heart notifications, clearer photo previews.
-- Run once in Supabase SQL Editor, after upgrade-008.sql,
-- and BEFORE turning off "Confirm email" in Supabase.

alter table public.profiles add column if not exists email_verified boolean not null default false;

-- ---------- Remove test accounts and test-account tools ----------
-- Deletes any accounts with emails ending in @test.sauchatz.app, then any groups left with no members.
delete from auth.users where email like '%@test.sauchatz.app';
delete from public.conversations c
where not exists (select 1 from public.conversation_members m where m.conversation_id = c.id);
drop function if exists public.admin_edit_test_message(uuid, text, boolean);
drop function if exists public.admin_list_test_messages();
drop function if exists public.admin_update_test_profile(uuid, text, text, boolean);
drop function if exists public.admin_list_test_accounts();
drop trigger if exists profiles_mark_test on public.profiles;
drop function if exists public.mark_test_profile();
drop function if exists public.is_test_account(uuid);
alter table public.profiles drop column if exists is_test;

-- Everyone who signed up so far had to confirm their email.
update public.profiles p set email_verified = true
from auth.users u
where u.id = p.id and u.email_confirmed_at is not null and not p.email_verified;

-- Marks the signed-in person as verified, but only when this session was opened
-- from a link or code sent to their email. Supabase signs that proof into the session token.
create or replace function public.mark_email_verified()
returns boolean language plpgsql security definer set search_path = public as $$
declare proved boolean;
begin
  if auth.uid() is null then return false; end if;
  select exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a
    where a ->> 'method' in ('otp', 'magiclink', 'email/signup', 'signup', 'invite', 'recovery', 'email_change', 'email')
  ) into proved;
  if proved then
    update profiles set email_verified = true where id = auth.uid() and not email_verified;
  end if;
  return coalesce((select email_verified from profiles where id = auth.uid()), false);
end;
$$;
revoke execute on function public.mark_email_verified() from public, anon;
grant execute on function public.mark_email_verified() to authenticated;

-- A new email address has to be verified again.
create or replace function public.reset_verified_on_email_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    update profiles set email_verified = false where id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists on_auth_email_changed on auth.users;
create trigger on_auth_email_changed
  after update of email on auth.users
  for each row execute function public.reset_verified_on_email_change();

-- ---------- Heart notifications ----------
-- You can see who sent you a heart, so the site can tell you.
drop policy if exists "see hearts I received" on public.profile_hearts;
create policy "see hearts I received" on public.profile_hearts
  for select to authenticated using (to_user = auth.uid());
alter table public.profile_hearts replica identity full;
do $$
begin
  begin
    alter publication supabase_realtime add table public.profile_hearts;
  exception when duplicate_object then null;
  end;
end $$;

-- Private photo previews: allow a slightly larger preview so outlines show through the blur.
alter table public.messages drop constraint if exists messages_image_blur;
alter table public.messages add constraint messages_image_blur
  check (image_blur is null or (image_blur like 'data:image/%;base64,%' and char_length(image_blur) <= 12000));
