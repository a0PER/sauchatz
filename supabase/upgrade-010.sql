-- Version 10: admins can change someone's display name for safety reasons,
-- and can stop them from changing it back.
-- Run once in Supabase SQL Editor, after upgrade-009.sql.

alter table public.profiles add column if not exists name_locked boolean not null default false;

-- People cannot change a name an admin has locked.
create or replace function public.guard_locked_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.name_locked and new.display_name is distinct from old.display_name
     and not public.am_i_admin() then
    raise exception 'Your name was set by an admin and cannot be changed.';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_guard_locked_name on public.profiles;
create trigger profiles_guard_locked_name before update on public.profiles
  for each row execute function public.guard_locked_name();

create or replace function public.admin_set_display_name(p_user uuid, p_name text, p_lock boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 60 then
    raise exception 'Names must be 1 to 60 characters';
  end if;
  update profiles set display_name = trim(p_name), name_locked = coalesce(p_lock, true) where id = p_user;
  if not found then raise exception 'Account not found'; end if;
end;
$$;
revoke execute on function public.admin_set_display_name(uuid, text, boolean) from public, anon;
grant execute on function public.admin_set_display_name(uuid, text, boolean) to authenticated;

-- Make the new function available to the website right away.
notify pgrst, 'reload schema';
