-- ============================================================================
-- ZerdeliGrade: authorization helpers, grants and Row Level Security
--
-- Principle: deny by default. RLS is enabled on every table; a role sees or
-- changes a row only when a policy below explicitly allows it. Tables that
-- hold scores, recognition output, memberships and audit entries have no
-- client write policies at all: they are written only by SECURITY DEFINER
-- functions that re-check permissions, or by the server with the service key.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so policies can consult membership tables
-- without recursive RLS evaluation). All pin search_path.
-- ---------------------------------------------------------------------------
create or replace function public.is_hq_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_hq_admin and p.is_active
  );
$$;

create or replace function public.has_center_access(p_center uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_hq_admin() or exists (
    select 1
    from public.center_memberships m
    join public.centers c on c.id = m.center_id
    join public.profiles p on p.id = m.user_id
    where m.user_id = auth.uid() and m.center_id = p_center
      and m.is_active and c.is_active and p.is_active
  );
$$;

create or replace function public.is_center_admin(p_center uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_hq_admin() or exists (
    select 1
    from public.center_memberships m
    join public.centers c on c.id = m.center_id
    join public.profiles p on p.id = m.user_id
    where m.user_id = auth.uid() and m.center_id = p_center
      and m.role = 'center_admin' and m.is_active and c.is_active and p.is_active
  );
$$;

create or replace function public.is_teacher_of_class(p_class uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.class_teachers ct
    join public.center_memberships m on m.center_id = ct.center_id and m.user_id = ct.user_id
    join public.centers c on c.id = ct.center_id
    join public.profiles p on p.id = ct.user_id
    where ct.class_id = p_class and ct.user_id = auth.uid()
      and m.is_active and c.is_active and p.is_active
  );
$$;

create or replace function public.can_access_class(p_center uuid, p_class uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_center_admin(p_center)
      or (p_class is not null and public.is_teacher_of_class(p_class));
$$;

create or replace function public.can_access_student(p_student uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.students s
    where s.id = p_student
      and (public.is_center_admin(s.center_id)
           or (s.class_id is not null and public.is_teacher_of_class(s.class_id)))
  );
$$;

-- Row-level form (uses the row's own columns, so it also works for a row
-- that is being inserted with RETURNING).
create or replace function public.can_read_test_row(
  p_id uuid, p_center uuid, p_is_template boolean, p_status text, p_created_by uuid
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select
    public.is_hq_admin()
    -- HQ shared templates: visible to every active staff member once published.
    or (p_center is null and p_is_template and p_status = 'published'
        and exists (select 1 from public.center_memberships m
                    join public.profiles p on p.id = m.user_id
                    where m.user_id = auth.uid() and m.is_active and p.is_active))
    or (p_center is not null and (
          public.is_center_admin(p_center)
          or (public.has_center_access(p_center) and (
                p_created_by = auth.uid()
                or p_is_template
                or exists (select 1 from public.test_assignments a
                           where a.test_id = p_id and public.is_teacher_of_class(a.class_id))
             ))
       ));
$$;

create or replace function public.can_read_test(p_test uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.tests t
    where t.id = p_test
      and public.can_read_test_row(t.id, t.center_id, t.is_template, t.status, t.created_by)
  );
$$;

create or replace function public.can_edit_test(p_test uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.tests t
    where t.id = p_test
      and (
        public.is_hq_admin()
        or (t.center_id is not null and (
              public.is_center_admin(t.center_id)
              or (public.has_center_access(t.center_id) and t.created_by = auth.uid())
           ))
      )
  );
$$;

-- Center admins see everything in their center; teachers see results of their
-- classes and results they created themselves.
create or replace function public.can_read_result_row(p_center uuid, p_class uuid, p_created_by uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_center_admin(p_center)
      or (public.has_center_access(p_center) and (
            p_created_by = auth.uid()
            or (p_class is not null and public.is_teacher_of_class(p_class))
         ));
$$;

create or replace function public.can_read_result(p_result uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.assessment_results r
    where r.id = p_result and public.can_read_result_row(r.center_id, r.class_id, r.created_by)
  );
$$;

create or replace function public.can_read_scan_job(p_job uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.scan_jobs j
    where j.id = p_job
      and (public.is_center_admin(j.center_id)
           or (public.has_center_access(j.center_id) and j.uploaded_by = auth.uid()))
  );
$$;

create or replace function public.shares_center_with(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.center_memberships m
    where m.user_id = p_user and public.has_center_access(m.center_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- Guard: center-owned rows can never be moved to another center.
-- ---------------------------------------------------------------------------
create or replace function public.prevent_center_change()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.center_id is distinct from old.center_id then
    raise exception 'center_id cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['classes', 'students', 'tests', 'answer_sheets', 'scan_jobs',
                           'assessment_results', 'file_metadata', 'center_memberships', 'test_assignments']
  loop
    execute format('create trigger %I_center_immutable before update on public.%I
                    for each row execute function public.prevent_center_change()', t, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. anon gets nothing. authenticated gets table privileges only where a
-- policy can allow the action; everything else is server-only.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all tables in schema public from authenticated;

grant select on all tables in schema public to authenticated;

-- profiles: users may change only their name and language.
grant update (full_name, preferred_locale) on public.profiles to authenticated;

grant insert, update, delete on public.centers to authenticated;          -- HQ only (policy)
grant insert, update, delete on public.classes to authenticated;          -- center admins
grant insert, update, delete on public.class_teachers to authenticated;   -- center admins
grant insert, update, delete on public.students to authenticated;         -- center admins
grant insert, update, delete on public.subjects to authenticated;         -- HQ only
grant insert, update, delete on public.tests to authenticated;
grant insert, update, delete on public.test_questions to authenticated;
grant insert, update, delete on public.answer_options to authenticated;
grant insert, update, delete on public.answer_keys to authenticated;
grant insert, update, delete on public.test_assignments to authenticated;
grant insert, delete on public.answer_sheets to authenticated;
-- No write grants: center_memberships, file_metadata, scan_jobs, recognized_answers,
-- assessment_results, result_answers, result_reviews, audit_logs.

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere.
-- ---------------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.centers             enable row level security;
alter table public.center_memberships  enable row level security;
alter table public.classes             enable row level security;
alter table public.class_teachers      enable row level security;
alter table public.students            enable row level security;
alter table public.subjects            enable row level security;
alter table public.tests               enable row level security;
alter table public.test_questions      enable row level security;
alter table public.answer_options      enable row level security;
alter table public.answer_keys         enable row level security;
alter table public.test_assignments    enable row level security;
alter table public.answer_sheets       enable row level security;
alter table public.file_metadata       enable row level security;
alter table public.scan_jobs           enable row level security;
alter table public.recognized_answers  enable row level security;
alter table public.assessment_results  enable row level security;
alter table public.result_answers      enable row level security;
alter table public.result_reviews      enable row level security;
alter table public.audit_logs          enable row level security;

-- profiles ------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_hq_admin() or public.shares_center_with(id));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- centers -------------------------------------------------------------------
create policy centers_select on public.centers for select to authenticated
  using (public.is_hq_admin() or public.has_center_access(id));
create policy centers_insert on public.centers for insert to authenticated
  with check (public.is_hq_admin());
create policy centers_update on public.centers for update to authenticated
  using (public.is_hq_admin()) with check (public.is_hq_admin());
create policy centers_delete on public.centers for delete to authenticated
  using (public.is_hq_admin());

-- center_memberships (read-only for clients) -------------------------------
create policy memberships_select on public.center_memberships for select to authenticated
  using (user_id = auth.uid() or public.is_center_admin(center_id));

-- classes -------------------------------------------------------------------
create policy classes_select on public.classes for select to authenticated
  using (public.is_center_admin(center_id) or public.is_teacher_of_class(id));
create policy classes_insert on public.classes for insert to authenticated
  with check (public.is_center_admin(center_id));
create policy classes_update on public.classes for update to authenticated
  using (public.is_center_admin(center_id)) with check (public.is_center_admin(center_id));
create policy classes_delete on public.classes for delete to authenticated
  using (public.is_center_admin(center_id));

-- class_teachers ------------------------------------------------------------
create policy class_teachers_select on public.class_teachers for select to authenticated
  using (user_id = auth.uid() or public.is_center_admin(center_id));
create policy class_teachers_insert on public.class_teachers for insert to authenticated
  with check (
    public.is_center_admin(center_id)
    and exists (select 1 from public.center_memberships m
                where m.user_id = class_teachers.user_id and m.center_id = class_teachers.center_id and m.is_active)
  );
create policy class_teachers_delete on public.class_teachers for delete to authenticated
  using (public.is_center_admin(center_id));

-- students ------------------------------------------------------------------
create policy students_select on public.students for select to authenticated
  using (public.is_center_admin(center_id)
         or (class_id is not null and public.is_teacher_of_class(class_id)));
create policy students_insert on public.students for insert to authenticated
  with check (public.is_center_admin(center_id));
create policy students_update on public.students for update to authenticated
  using (public.is_center_admin(center_id)) with check (public.is_center_admin(center_id));
create policy students_delete on public.students for delete to authenticated
  using (public.is_center_admin(center_id));

-- subjects ------------------------------------------------------------------
create policy subjects_select on public.subjects for select to authenticated using (true);
create policy subjects_insert on public.subjects for insert to authenticated with check (public.is_hq_admin());
create policy subjects_update on public.subjects for update to authenticated
  using (public.is_hq_admin()) with check (public.is_hq_admin());
create policy subjects_delete on public.subjects for delete to authenticated using (public.is_hq_admin());

-- tests ---------------------------------------------------------------------
create policy tests_select on public.tests for select to authenticated
  using (public.can_read_test_row(id, center_id, is_template, status, created_by));
create policy tests_insert on public.tests for insert to authenticated
  with check (
    created_by = auth.uid() and status = 'draft' and (
      (center_id is null and is_template and public.is_hq_admin())
      or (center_id is not null and public.has_center_access(center_id))
    )
  );
create policy tests_update on public.tests for update to authenticated
  using (public.can_edit_test(id))
  with check (
    (center_id is null and public.is_hq_admin())
    or (center_id is not null and public.has_center_access(center_id))
  );
create policy tests_delete on public.tests for delete to authenticated
  using (public.can_edit_test(id) and status = 'draft');

-- questions / options / keys follow the parent test --------------------------
create policy questions_select on public.test_questions for select to authenticated
  using (public.can_read_test(test_id));
create policy questions_insert on public.test_questions for insert to authenticated
  with check (public.can_edit_test(test_id));
create policy questions_update on public.test_questions for update to authenticated
  using (public.can_edit_test(test_id)) with check (public.can_edit_test(test_id));
create policy questions_delete on public.test_questions for delete to authenticated
  using (public.can_edit_test(test_id));

create policy options_select on public.answer_options for select to authenticated
  using (exists (select 1 from public.test_questions q
                 where q.id = answer_options.question_id and public.can_read_test(q.test_id)));
create policy options_insert on public.answer_options for insert to authenticated
  with check (exists (select 1 from public.test_questions q
                      where q.id = answer_options.question_id and public.can_edit_test(q.test_id)));
create policy options_update on public.answer_options for update to authenticated
  using (exists (select 1 from public.test_questions q
                 where q.id = answer_options.question_id and public.can_edit_test(q.test_id)))
  with check (exists (select 1 from public.test_questions q
                      where q.id = answer_options.question_id and public.can_edit_test(q.test_id)));
create policy options_delete on public.answer_options for delete to authenticated
  using (exists (select 1 from public.test_questions q
                 where q.id = answer_options.question_id and public.can_edit_test(q.test_id)));

create policy keys_select on public.answer_keys for select to authenticated
  using (public.can_read_test(test_id));
create policy keys_insert on public.answer_keys for insert to authenticated
  with check (public.can_edit_test(test_id)
              and exists (select 1 from public.test_questions q
                          where q.id = answer_keys.question_id and q.test_id = answer_keys.test_id));
create policy keys_update on public.answer_keys for update to authenticated
  using (public.can_edit_test(test_id))
  with check (public.can_edit_test(test_id)
              and exists (select 1 from public.test_questions q
                          where q.id = answer_keys.question_id and q.test_id = answer_keys.test_id));
create policy keys_delete on public.answer_keys for delete to authenticated
  using (public.can_edit_test(test_id));

-- test_assignments ----------------------------------------------------------
create policy assignments_select on public.test_assignments for select to authenticated
  using (public.is_center_admin(center_id) or public.is_teacher_of_class(class_id));
create policy assignments_insert on public.test_assignments for insert to authenticated
  with check (
    public.is_center_admin(center_id)
    or (public.can_edit_test(test_id) and public.is_teacher_of_class(class_id))
  );
create policy assignments_delete on public.test_assignments for delete to authenticated
  using (
    public.is_center_admin(center_id)
    or (public.can_edit_test(test_id) and public.is_teacher_of_class(class_id))
  );

-- answer_sheets -------------------------------------------------------------
create policy sheets_select on public.answer_sheets for select to authenticated
  using (
    public.is_center_admin(center_id)
    or (public.has_center_access(center_id) and created_by = auth.uid())
    or (class_id is not null and public.is_teacher_of_class(class_id))
  );
create policy sheets_insert on public.answer_sheets for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.has_center_access(center_id)
    and public.can_read_test(test_id)
    and (class_id is null or public.can_access_class(center_id, class_id))
    and (student_id is null or public.can_access_student(student_id))
  );
create policy sheets_delete on public.answer_sheets for delete to authenticated
  using (public.is_center_admin(center_id) or created_by = auth.uid());

-- file_metadata / scan_jobs / recognized_answers (read-only for clients) -----
-- A photo is visible to center admins, its uploader, and anyone who can read
-- a result produced from it (e.g. the teacher of the student's class).
create or replace function public.can_read_file(p_file uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.file_metadata f
    where f.id = p_file
      and (public.is_center_admin(f.center_id)
           or (public.has_center_access(f.center_id) and f.uploaded_by = auth.uid())
           or exists (select 1 from public.scan_jobs j
                      join public.assessment_results r on r.scan_job_id = j.id
                      where j.file_id = f.id and public.can_read_result_row(r.center_id, r.class_id, r.created_by)))
  );
$$;

create policy files_select on public.file_metadata for select to authenticated
  using (public.can_read_file(id));

create policy scan_jobs_select on public.scan_jobs for select to authenticated
  using (public.is_center_admin(center_id)
         or (public.has_center_access(center_id) and uploaded_by = auth.uid()));

create policy recognized_select on public.recognized_answers for select to authenticated
  using (public.can_read_scan_job(scan_job_id));

-- results (read-only for clients; written by SECURITY DEFINER functions) ------
create policy results_select on public.assessment_results for select to authenticated
  using (public.can_read_result_row(center_id, class_id, created_by));
create policy result_answers_select on public.result_answers for select to authenticated
  using (public.can_read_result(result_id));
create policy result_reviews_select on public.result_reviews for select to authenticated
  using (public.can_read_result(result_id));

-- audit_logs ----------------------------------------------------------------
create policy audit_select on public.audit_logs for select to authenticated
  using (public.is_hq_admin() or (center_id is not null and public.is_center_admin(center_id)));

-- Helper functions are callable by signed-in users (policies need them).
grant execute on function public.is_hq_admin() to authenticated;
grant execute on function public.has_center_access(uuid) to authenticated;
grant execute on function public.is_center_admin(uuid) to authenticated;
grant execute on function public.is_teacher_of_class(uuid) to authenticated;
grant execute on function public.can_access_class(uuid, uuid) to authenticated;
grant execute on function public.can_access_student(uuid) to authenticated;
grant execute on function public.can_read_test(uuid) to authenticated;
grant execute on function public.can_read_test_row(uuid, uuid, boolean, text, uuid) to authenticated;
grant execute on function public.can_edit_test(uuid) to authenticated;
grant execute on function public.can_read_result_row(uuid, uuid, uuid) to authenticated;
grant execute on function public.can_read_result(uuid) to authenticated;
grant execute on function public.can_read_scan_job(uuid) to authenticated;
grant execute on function public.shares_center_with(uuid) to authenticated;
grant execute on function public.can_read_file(uuid) to authenticated;
