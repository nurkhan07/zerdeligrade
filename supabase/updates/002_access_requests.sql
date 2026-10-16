-- ZerdeliGrade update 002: self-registration with access requests.
-- Run ONCE in Supabase -> SQL Editor (after update 001).

-- ============================================================================
-- ZerdeliGrade: self-registration with access requests
--
-- Anyone can sign up (email confirmed with a one-time code by Supabase Auth),
-- but a new account sees nothing until a center admin (or HQ) approves its
-- access request. Approval creates a 'teacher' membership; center admins are
-- still appointed by HQ through invitations.
-- ============================================================================

create table public.access_requests (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  center_id        uuid not null references public.centers (id) on delete cascade,
  full_name        text not null check (char_length(full_name) between 2 and 200),
  email            text not null default '',
  message          text not null default '' check (char_length(message) <= 500),
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by       uuid references public.profiles (id) on delete set null,
  decided_at       timestamptz,
  decision_comment text not null default '' check (char_length(decision_comment) <= 1000),
  created_at       timestamptz not null default now()
);
create unique index access_requests_one_pending on public.access_requests (user_id) where status = 'pending';
create index access_requests_center_idx on public.access_requests (center_id, status, created_at desc);

alter table public.access_requests enable row level security;
revoke all on public.access_requests from anon, authenticated;
grant select on public.access_requests to authenticated;
create policy access_requests_select on public.access_requests for select to authenticated
  using (user_id = auth.uid() or public.is_center_admin(center_id));

-- Centers a newcomer may apply to (names only; RLS hides centers from non-members).
create or replace function public.list_signup_centers()
returns table (id uuid, name text, city text)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.name, c.city from public.centers c
  where c.is_active and not c.is_demo
  order by c.name;
$$;

create or replace function public.request_access(p_center uuid, p_full_name text, p_message text default '')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'ZG_FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null) then
    raise exception 'ZG_EMAIL_NOT_CONFIRMED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.centers c where c.id = p_center and c.is_active and not c.is_demo) then
    raise exception 'ZG_NOT_FOUND' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.center_memberships m where m.user_id = v_uid and m.center_id = p_center and m.is_active) then
    raise exception 'ZG_ALREADY_MEMBER' using errcode = '23505';
  end if;
  if exists (select 1 from public.access_requests r where r.user_id = v_uid and r.status = 'pending') then
    raise exception 'ZG_REQUEST_PENDING' using errcode = '23505';
  end if;
  if char_length(trim(coalesce(p_full_name, ''))) < 2 then
    raise exception 'ZG_INVALID_ANSWERS' using errcode = '22023';
  end if;

  insert into public.access_requests (user_id, center_id, full_name, email, message)
  values (v_uid, p_center, left(trim(p_full_name), 200),
          coalesce((select u.email from auth.users u where u.id = v_uid), ''),
          left(trim(coalesce(p_message, '')), 500))
  returning id into v_id;
  update public.profiles set full_name = left(trim(p_full_name), 200) where id = v_uid;
  perform public.write_audit(p_center, v_uid, 'access.requested', 'access_request', v_id::text, '{}'::jsonb);
  return v_id;
end;
$$;

create or replace function public.decide_access_request(p_request uuid, p_approve boolean, p_comment text default '')
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_r public.access_requests%rowtype;
begin
  select * into v_r from public.access_requests where id = p_request for update;
  if not found or not public.is_center_admin(v_r.center_id) or v_r.user_id = auth.uid() then
    raise exception 'ZG_FORBIDDEN' using errcode = '42501';
  end if;
  if v_r.status <> 'pending' then
    raise exception 'ZG_INVALID_STATUS' using errcode = '22023';
  end if;
  if not p_approve and char_length(trim(coalesce(p_comment, ''))) < 3 then
    raise exception 'ZG_COMMENT_REQUIRED' using errcode = '22023';
  end if;

  update public.access_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = auth.uid(), decided_at = now(), decision_comment = left(trim(coalesce(p_comment, '')), 1000)
  where id = p_request;

  if p_approve then
    insert into public.center_memberships (center_id, user_id, role, can_finalize, created_by)
    values (v_r.center_id, v_r.user_id, 'teacher', false, auth.uid())
    on conflict (center_id, user_id) do update set is_active = true;
  end if;
  perform public.write_audit(v_r.center_id, auth.uid(),
                             case when p_approve then 'access.approved' else 'access.rejected' end,
                             'access_request', p_request::text,
                             jsonb_build_object('user_id', v_r.user_id, 'comment', left(coalesce(p_comment, ''), 200)));
end;
$$;

revoke execute on function public.list_signup_centers() from public, anon;
revoke execute on function public.request_access(uuid, text, text) from public, anon;
revoke execute on function public.decide_access_request(uuid, boolean, text) from public, anon;
grant execute on function public.list_signup_centers() to authenticated;
grant execute on function public.request_access(uuid, text, text) to authenticated;
grant execute on function public.decide_access_request(uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
