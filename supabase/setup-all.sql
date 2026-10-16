-- ZerdeliGrade: all migrations in one file for the Supabase SQL Editor.
-- Generated from supabase/migrations/*.sql. Run once on an EMPTY project.


-- ===== supabase/migrations/20261014000001_schema.sql =====
-- ============================================================================
-- ZerdeliGrade: core schema
--
-- Design notes
-- * One shared PostgreSQL database for the whole Zerdeli network. Isolation
--   between centers is logical: RLS (see 20261014000002_rls.sql) plus
--   server-side authorization.
-- * Every center-owned row carries center_id. Child tables reference their
--   parent with a composite foreign key (parent_id, center_id) so a row can
--   never point at a parent that belongs to another center.
-- * Scores are never written by clients. They are computed inside PostgreSQL
--   by SECURITY DEFINER functions (20261014000003_functions.sql).
-- ============================================================================

-- gen_random_uuid() is built into PostgreSQL 13+; no extension needed.

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user. Role flags here are NOT client-writable.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  email            text,
  full_name        text not null default '' check (char_length(full_name) <= 200),
  preferred_locale text not null default 'kk' check (preferred_locale in ('kk', 'ru')),
  is_hq_admin      boolean not null default false,
  is_active        boolean not null default true,
  is_demo          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create a profile automatically for every new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, preferred_locale)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when new.raw_user_meta_data ->> 'preferred_locale' in ('kk', 'ru')
         then new.raw_user_meta_data ->> 'preferred_locale' else 'kk' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- centers
-- ---------------------------------------------------------------------------
create table public.centers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 2 and 200),
  code       text not null unique check (code ~ '^[A-Z0-9-]{2,20}$'),
  city       text not null default '' check (char_length(city) <= 100),
  address    text not null default '' check (char_length(address) <= 300),
  is_active  boolean not null default true,
  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger centers_updated_at before update on public.centers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- center_memberships: who works in which center and in which role.
-- Written only by the server (service role) after authorization checks.
-- ---------------------------------------------------------------------------
create table public.center_memberships (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references public.centers (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         text not null check (role in ('center_admin', 'teacher')),
  -- Teachers may finalize results only when this is true.
  can_finalize boolean not null default true,
  is_active    boolean not null default true,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (center_id, user_id)
);
create index center_memberships_user_idx on public.center_memberships (user_id) where is_active;
create trigger center_memberships_updated_at before update on public.center_memberships
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- classes (classes and study groups)
-- ---------------------------------------------------------------------------
create table public.classes (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references public.centers (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 100),
  kind          text not null default 'class' check (kind in ('class', 'group')),
  grade         smallint check (grade between 0 and 12),
  academic_year text not null default '' check (char_length(academic_year) <= 20),
  is_active     boolean not null default true,
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, center_id),
  unique (center_id, name, academic_year)
);
create index classes_center_idx on public.classes (center_id);
create trigger classes_updated_at before update on public.classes
  for each row execute function public.set_updated_at();

-- Teachers assigned to classes. A teacher sees only students/results of these classes.
create table public.class_teachers (
  class_id   uuid not null,
  center_id  uuid not null,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (class_id, user_id),
  foreign key (class_id, center_id) references public.classes (id, center_id) on delete cascade
);
create index class_teachers_user_idx on public.class_teachers (user_id);

-- ---------------------------------------------------------------------------
-- students: minimal personal data only (no birth date, address, phone, IIN).
-- ---------------------------------------------------------------------------
create table public.students (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references public.centers (id) on delete cascade,
  class_id     uuid,
  first_name   text not null check (char_length(first_name) between 1 and 100),
  last_name    text not null check (char_length(last_name) between 1 and 100),
  student_code text check (student_code ~ '^[A-Za-z0-9_-]{1,32}$'),
  status       text not null default 'active' check (status in ('active', 'inactive', 'graduated')),
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, center_id),
  foreign key (class_id, center_id) references public.classes (id, center_id) on delete set null (class_id)
);
create unique index students_center_code_uq on public.students (center_id, lower(student_code))
  where student_code is not null;
create index students_center_class_idx on public.students (center_id, class_id);
create index students_name_idx on public.students (center_id, lower(last_name), lower(first_name));
create trigger students_updated_at before update on public.students
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- subjects: network-wide dictionary managed by HQ.
-- ---------------------------------------------------------------------------
create table public.subjects (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code ~ '^[a-z0-9_-]{2,40}$'),
  name_kk    text not null check (char_length(name_kk) between 1 and 100),
  name_ru    text not null check (char_length(name_ru) between 1 and 100),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- tests. center_id is null only for HQ-shared templates.
-- Questions and answer keys are editable only while the test is a draft.
-- ---------------------------------------------------------------------------
create table public.tests (
  id                 uuid primary key default gen_random_uuid(),
  center_id          uuid references public.centers (id) on delete cascade,
  is_template        boolean not null default false,
  title              text not null check (char_length(title) between 2 and 200),
  subject_id         uuid not null references public.subjects (id),
  grade              smallint check (grade between 0 and 12),
  language           text not null default 'kk' check (language in ('kk', 'ru')),
  instructions       text not null default '' check (char_length(instructions) <= 2000),
  question_count     smallint not null check (question_count between 1 and 120),
  negative_marking   boolean not null default false,
  negative_points    numeric(6, 2) not null default 0 check (negative_points >= 0 and negative_points <= 10),
  passing_score      numeric(8, 2) not null default 0 check (passing_score >= 0),
  time_limit_minutes smallint check (time_limit_minutes between 1 and 600),
  status             text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  source_test_id     uuid references public.tests (id) on delete set null,
  is_demo            boolean not null default false,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  published_at       timestamptz,
  unique (id, center_id),
  check (center_id is not null or is_template)
);
create index tests_center_idx on public.tests (center_id, status);
create index tests_template_idx on public.tests (is_template) where is_template;
create trigger tests_updated_at before update on public.tests
  for each row execute function public.set_updated_at();

create table public.test_questions (
  id            uuid primary key default gen_random_uuid(),
  test_id       uuid not null references public.tests (id) on delete cascade,
  position      smallint not null check (position between 1 and 120),
  question_type text not null default 'single_choice' check (question_type in ('single_choice', 'true_false')),
  prompt        text not null default '' check (char_length(prompt) <= 2000),
  points        numeric(6, 2) not null default 1 check (points > 0 and points <= 100),
  created_at    timestamptz not null default now(),
  unique (test_id, position)
);

-- Option labels are always latin A-E because they map to printed bubbles.
-- For true/false questions A = true, B = false.
create table public.answer_options (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.test_questions (id) on delete cascade,
  label       text not null check (label in ('A', 'B', 'C', 'D', 'E')),
  text        text not null default '' check (char_length(text) <= 500),
  unique (question_id, label)
);

create table public.answer_keys (
  question_id   uuid primary key references public.test_questions (id) on delete cascade,
  test_id       uuid not null references public.tests (id) on delete cascade,
  correct_label text not null check (correct_label in ('A', 'B', 'C', 'D', 'E')),
  updated_at    timestamptz not null default now()
);
create index answer_keys_test_idx on public.answer_keys (test_id);

-- ---------------------------------------------------------------------------
-- test_assignments: which classes take which test.
-- ---------------------------------------------------------------------------
create table public.test_assignments (
  id          uuid primary key default gen_random_uuid(),
  test_id     uuid not null,
  center_id   uuid not null,
  class_id    uuid not null,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  due_at      timestamptz,
  unique (test_id, class_id),
  foreign key (test_id, center_id) references public.tests (id, center_id) on delete cascade,
  foreign key (class_id, center_id) references public.classes (id, center_id) on delete cascade
);
create index test_assignments_class_idx on public.test_assignments (class_id);

-- ---------------------------------------------------------------------------
-- answer_sheets: every printed sheet has a unique code encoded in its QR.
-- ---------------------------------------------------------------------------
create table public.answer_sheets (
  id                 uuid primary key default gen_random_uuid(),
  center_id          uuid not null references public.centers (id) on delete cascade,
  test_id            uuid not null,
  class_id           uuid,
  student_id         uuid,
  sheet_code         text not null unique check (sheet_code ~ '^[A-Z2-9]{10}$'),
  batch_id           uuid not null default gen_random_uuid(),
  language           text not null check (language in ('kk', 'ru')),
  question_count     smallint not null check (question_count between 1 and 120),
  layout_version     smallint not null default 1,
  student_label      text not null default '' check (char_length(student_label) <= 200),
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (id, center_id),
  foreign key (test_id, center_id) references public.tests (id, center_id) on delete cascade,
  foreign key (class_id, center_id) references public.classes (id, center_id) on delete set null (class_id),
  foreign key (student_id, center_id) references public.students (id, center_id) on delete set null (student_id)
);
create index answer_sheets_batch_idx on public.answer_sheets (batch_id);
create index answer_sheets_test_idx on public.answer_sheets (center_id, test_id);

-- ---------------------------------------------------------------------------
-- file_metadata: every object in private storage is registered here.
-- ---------------------------------------------------------------------------
create table public.file_metadata (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references public.centers (id) on delete cascade,
  bucket        text not null,
  object_path   text not null,
  original_name text not null default '' check (char_length(original_name) <= 255),
  mime_type     text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes    integer not null check (size_bytes > 0 and size_bytes <= 15728640),
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by   uuid references public.profiles (id) on delete set null,
  delete_after  timestamptz not null default (now() + interval '365 days'),
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  unique (bucket, object_path),
  unique (id, center_id)
);
create index file_metadata_retention_idx on public.file_metadata (delete_after) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- scan_jobs: one uploaded photo and its processing state.
-- ---------------------------------------------------------------------------
create table public.scan_jobs (
  id              uuid primary key default gen_random_uuid(),
  center_id       uuid not null references public.centers (id) on delete cascade,
  test_id         uuid not null,
  answer_sheet_id uuid,
  file_id         uuid,
  batch_id        uuid,
  status          text not null default 'uploaded'
                  check (status in ('uploaded', 'processing', 'needs_review', 'reviewed', 'finalized', 'failed')),
  error_code      text,
  error_detail    text,
  quality         jsonb not null default '{}'::jsonb,
  uploaded_by     uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, center_id),
  foreign key (test_id, center_id) references public.tests (id, center_id) on delete cascade,
  foreign key (answer_sheet_id, center_id) references public.answer_sheets (id, center_id) on delete set null (answer_sheet_id),
  foreign key (file_id, center_id) references public.file_metadata (id, center_id) on delete set null (file_id)
);
create index scan_jobs_center_idx on public.scan_jobs (center_id, created_at desc);
create index scan_jobs_batch_idx on public.scan_jobs (batch_id);
create trigger scan_jobs_updated_at before update on public.scan_jobs
  for each row execute function public.set_updated_at();

-- Raw machine recognition per question (never edited; corrections go to results).
create table public.recognized_answers (
  id                uuid primary key default gen_random_uuid(),
  scan_job_id       uuid not null,
  center_id         uuid not null,
  question_position smallint not null check (question_position between 1 and 120),
  detected_labels   text[] not null default '{}',
  chosen_label      text check (chosen_label in ('A', 'B', 'C', 'D', 'E')),
  status            text not null check (status in ('ok', 'blank', 'multiple', 'uncertain')),
  confidence        numeric(4, 3) not null check (confidence between 0 and 1),
  fill_levels       jsonb not null default '{}'::jsonb,
  unique (scan_job_id, question_position),
  foreign key (scan_job_id, center_id) references public.scan_jobs (id, center_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- assessment_results and per-question detail
-- ---------------------------------------------------------------------------
create table public.assessment_results (
  id              uuid primary key default gen_random_uuid(),
  center_id       uuid not null references public.centers (id) on delete cascade,
  test_id         uuid not null,
  student_id      uuid,
  class_id        uuid,
  answer_sheet_id uuid,
  scan_job_id     uuid unique,
  source          text not null default 'scan' check (source in ('scan', 'manual')),
  correct_count   smallint not null default 0,
  incorrect_count smallint not null default 0,
  blank_count     smallint not null default 0,
  score           numeric(8, 2) not null default 0,
  max_score       numeric(8, 2) not null default 0,
  percentage      numeric(5, 2) not null default 0,
  passed          boolean not null default false,
  -- Recognition warnings that still need a human decision (multiple / uncertain / quality).
  warnings        jsonb not null default '[]'::jsonb,
  open_warning_count smallint not null default 0,
  correction_count smallint not null default 0,
  status          text not null default 'needs_review'
                  check (status in ('uploaded', 'processing', 'needs_review', 'reviewed', 'finalized', 'failed')),
  created_by      uuid references public.profiles (id) on delete set null,
  reviewed_by     uuid references public.profiles (id) on delete set null,
  reviewed_at     timestamptz,
  finalized_by    uuid references public.profiles (id) on delete set null,
  finalized_at    timestamptz,
  submitted_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  is_demo         boolean not null default false,
  unique (id, center_id),
  foreign key (test_id, center_id) references public.tests (id, center_id) on delete cascade,
  foreign key (student_id, center_id) references public.students (id, center_id) on delete set null (student_id),
  foreign key (class_id, center_id) references public.classes (id, center_id) on delete set null (class_id),
  foreign key (answer_sheet_id, center_id) references public.answer_sheets (id, center_id) on delete set null (answer_sheet_id),
  foreign key (scan_job_id, center_id) references public.scan_jobs (id, center_id) on delete set null (scan_job_id)
);
create index assessment_results_center_idx on public.assessment_results (center_id, submitted_at desc);
create index assessment_results_test_idx on public.assessment_results (test_id, status);
create index assessment_results_student_idx on public.assessment_results (student_id);
create index assessment_results_class_idx on public.assessment_results (class_id);
create trigger assessment_results_updated_at before update on public.assessment_results
  for each row execute function public.set_updated_at();

-- Final per-question answers used for scoring and analytics.
create table public.result_answers (
  result_id         uuid not null,
  center_id         uuid not null,
  test_id           uuid not null,
  question_position smallint not null check (question_position between 1 and 120),
  recognized_label  text check (recognized_label in ('A', 'B', 'C', 'D', 'E')),
  selected_label    text check (selected_label in ('A', 'B', 'C', 'D', 'E')),
  correct_label     text check (correct_label in ('A', 'B', 'C', 'D', 'E')),
  is_correct        boolean not null default false,
  points_awarded    numeric(6, 2) not null default 0,
  recognition_status text check (recognition_status in ('ok', 'blank', 'multiple', 'uncertain')),
  primary key (result_id, question_position),
  foreign key (result_id, center_id) references public.assessment_results (id, center_id) on delete cascade
);
create index result_answers_test_idx on public.result_answers (test_id, question_position);

-- Every manual change, review, finalization and reopen of a result.
create table public.result_reviews (
  id                uuid primary key default gen_random_uuid(),
  result_id         uuid not null,
  center_id         uuid not null,
  reviewer_id       uuid references public.profiles (id) on delete set null,
  action            text not null check (action in ('correction', 'review', 'finalize', 'reopen', 'student_link')),
  question_position smallint,
  previous_value    text,
  new_value         text,
  previous_score    numeric(8, 2),
  new_score         numeric(8, 2),
  comment           text not null default '' check (char_length(comment) <= 1000),
  created_at        timestamptz not null default now(),
  foreign key (result_id, center_id) references public.assessment_results (id, center_id) on delete cascade
);
create index result_reviews_result_idx on public.result_reviews (result_id, created_at);

-- ---------------------------------------------------------------------------
-- audit_logs: append-only.
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  center_id   uuid references public.centers (id) on delete set null,
  actor_id    uuid references public.profiles (id) on delete set null,
  action      text not null check (char_length(action) <= 100),
  entity_type text not null check (char_length(entity_type) <= 60),
  entity_id   text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index audit_logs_center_idx on public.audit_logs (center_id, created_at desc);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

create or replace function public.audit_logs_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The only permitted change is the FK "on delete set null" when a center or
  -- profile is removed; the log entry itself is preserved.
  if tg_op = 'UPDATE'
     and new.action = old.action and new.entity_type = old.entity_type
     and new.entity_id is not distinct from old.entity_id
     and new.details = old.details and new.created_at = old.created_at
     and (new.center_id is not distinct from old.center_id or new.center_id is null)
     and (new.actor_id is not distinct from old.actor_id or new.actor_id is null) then
    return new;
  end if;
  raise exception 'audit_logs is append-only';
end;
$$;
create trigger audit_logs_no_update before update or delete on public.audit_logs
  for each row execute function public.audit_logs_immutable();


-- ===== supabase/migrations/20261014000002_rls.sql =====
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


-- ===== supabase/migrations/20261014000003_functions.sql =====
-- ============================================================================
-- ZerdeliGrade: business functions
--
-- Error convention: functions raise exceptions whose message is a stable code
-- starting with ZG_ (e.g. ZG_FORBIDDEN). The application translates these
-- codes into Kazakh / Russian messages.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Internal audit writer (not executable by clients).
-- ---------------------------------------------------------------------------
create or replace function public.write_audit(
  p_center uuid, p_actor uuid, p_action text, p_entity_type text, p_entity_id text, p_details jsonb default '{}'::jsonb
)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.audit_logs (center_id, actor_id, action, entity_type, entity_id, details)
  values (p_center, p_actor, p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Draft lock: questions, options and keys can change only while the test is a
-- draft. Once results exist the answer key must not silently change.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_test_draft()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_test uuid;
  v_status text;
  v_question uuid;
begin
  if tg_table_name = 'answer_options' then
    v_question := case when tg_op = 'DELETE' then old.question_id else new.question_id end;
    select q.test_id into v_test from public.test_questions q where q.id = v_question;
  elsif tg_op = 'DELETE' then
    v_test := old.test_id;
  else
    v_test := new.test_id;
  end if;

  select t.status into v_status from public.tests t where t.id = v_test;
  -- Parent already gone (cascading delete) or still a draft: allowed.
  if v_status is null or v_status = 'draft' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'ZG_TEST_LOCKED' using errcode = '42501';
end;
$$;

create trigger test_questions_draft_lock before insert or update or delete on public.test_questions
  for each row execute function public.enforce_test_draft();
create trigger answer_options_draft_lock before insert or update or delete on public.answer_options
  for each row execute function public.enforce_test_draft();
create trigger answer_keys_draft_lock before insert or update or delete on public.answer_keys
  for each row execute function public.enforce_test_draft();

-- Status rules for tests: draft -> published only through publish_test();
-- published <-> archived is allowed; nothing goes back to draft.
create or replace function public.guard_test_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.status <> 'draft' and new.question_count <> old.question_count then
    raise exception 'ZG_TEST_LOCKED' using errcode = '42501';
  end if;
  if new.status = 'draft' and old.status <> 'draft' then
    raise exception 'ZG_INVALID_STATUS' using errcode = '22023';
  end if;
  if old.status = 'draft' and new.status <> 'draft'
     and coalesce(current_setting('zerdeligrade.publishing', true), '') <> 'on' then
    raise exception 'ZG_PUBLISH_REQUIRED' using errcode = '42501';
  end if;
  if new.is_template is distinct from old.is_template and old.center_id is null then
    raise exception 'ZG_INVALID_STATUS' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger tests_guard before update on public.tests
  for each row execute function public.guard_test_update();

-- ---------------------------------------------------------------------------
-- save_test_content: atomically replace all questions, options and keys of a
-- draft test.
-- p_questions: [{ "position":1, "type":"single_choice", "prompt":"", "points":1,
--                 "options":[{"label":"A","text":""},...], "correct":"B" }, ...]
-- ---------------------------------------------------------------------------
create or replace function public.save_test_content(p_test uuid, p_questions jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_test public.tests%rowtype;
  v_q jsonb;
  v_n int;
  v_pos int;
  v_type text;
  v_labels text[];
  v_correct text;
  v_points numeric;
  v_qid uuid;
  v_expected text[];
begin
  select * into v_test from public.tests where id = p_test for update;
  if not found or not public.can_edit_test(p_test) then
    raise exception 'ZG_FORBIDDEN' using errcode = '42501';
  end if;
  if v_test.status <> 'draft' then
    raise exception 'ZG_TEST_LOCKED' using errcode = '42501';
  end if;
  if jsonb_typeof(p_questions) <> 'array' then
    raise exception 'ZG_INVALID_QUESTIONS' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_questions);
  if v_n < 1 or v_n > 120 then
    raise exception 'ZG_INVALID_QUESTIONS' using errcode = '22023';
  end if;

  delete from public.test_questions where test_id = p_test;

  for v_q in select value from jsonb_array_elements(p_questions) loop
    v_pos := (v_q ->> 'position')::int;
    v_type := coalesce(v_q ->> 'type', 'single_choice');
    v_points := coalesce((v_q ->> 'points')::numeric, 1);
    v_correct := nullif(v_q ->> 'correct', '');
    select coalesce(array_agg(o ->> 'label' order by o ->> 'label'), '{}')
      into v_labels from jsonb_array_elements(coalesce(v_q -> 'options', '[]'::jsonb)) o;

    if v_pos is null or v_pos < 1 or v_pos > v_n then
      raise exception 'ZG_INVALID_QUESTIONS' using errcode = '22023', detail = 'position';
    end if;
    if v_type = 'true_false' then
      v_expected := array['A', 'B'];
    elsif v_type = 'single_choice' then
      if cardinality(v_labels) < 2 or cardinality(v_labels) > 5 then
        raise exception 'ZG_INVALID_QUESTIONS' using errcode = '22023', detail = 'options';
      end if;
      v_expected := (array['A', 'B', 'C', 'D', 'E'])[1:cardinality(v_labels)];
    else
      raise exception 'ZG_INVALID_QUESTIONS' using errcode = '22023', detail = 'type';
    end if;
    if v_labels <> v_expected then
      raise exception 'ZG_INVALID_QUESTIONS' using errcode = '22023', detail = 'labels';
    end if;
    if v_correct is not null and not (v_correct = any (v_expected)) then
      raise exception 'ZG_INVALID_KEY' using errcode = '22023', detail = v_pos::text;
    end if;
    if v_points <= 0 or v_points > 100 then
      raise exception 'ZG_INVALID_QUESTIONS' using errcode = '22023', detail = 'points';
    end if;

    insert into public.test_questions (test_id, position, question_type, prompt, points)
    values (p_test, v_pos, v_type, left(coalesce(v_q ->> 'prompt', ''), 2000), v_points)
    returning id into v_qid;

    insert into public.answer_options (question_id, label, text)
    select v_qid, o ->> 'label', left(coalesce(o ->> 'text', ''), 500)
    from jsonb_array_elements(v_q -> 'options') o;

    if v_correct is not null then
      insert into public.answer_keys (question_id, test_id, correct_label)
      values (v_qid, p_test, v_correct);
    end if;
  end loop;

  -- Positions must be exactly 1..n (unique constraint already prevents duplicates).
  if (select count(*) from public.test_questions where test_id = p_test) <> v_n then
    raise exception 'ZG_INVALID_QUESTIONS' using errcode = '22023', detail = 'positions';
  end if;

  update public.tests set question_count = v_n where id = p_test;
  perform public.write_audit(v_test.center_id, auth.uid(), 'test.content_saved', 'test', p_test::text,
                             jsonb_build_object('questions', v_n));
end;
$$;

-- ---------------------------------------------------------------------------
-- publish_test: validates completeness and locks the answer key.
-- ---------------------------------------------------------------------------
create or replace function public.publish_test(p_test uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_test public.tests%rowtype;
  v_missing int;
begin
  select * into v_test from public.tests where id = p_test for update;
  if not found or not public.can_edit_test(p_test) then
    raise exception 'ZG_FORBIDDEN' using errcode = '42501';
  end if;
  if v_test.status <> 'draft' then
    raise exception 'ZG_INVALID_STATUS' using errcode = '22023';
  end if;
  if (select count(*) from public.test_questions where test_id = p_test) <> v_test.question_count then
    raise exception 'ZG_TEST_INCOMPLETE' using errcode = '22023', detail = 'questions';
  end if;
  select count(*) into v_missing
  from public.test_questions q
  left join public.answer_keys k on k.question_id = q.id
  where q.test_id = p_test and k.question_id is null;
  if v_missing > 0 then
    raise exception 'ZG_TEST_INCOMPLETE' using errcode = '22023', detail = 'keys';
  end if;

  perform set_config('zerdeligrade.publishing', 'on', true);
  update public.tests set status = 'published', published_at = now() where id = p_test;
  perform set_config('zerdeligrade.publishing', 'off', true);
  perform public.write_audit(v_test.center_id, auth.uid(), 'test.published', 'test', p_test::text, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- duplicate_test: copy a readable test (or template) into a center, or as an
-- HQ template (p_center null, HQ only). The copy is always a draft.
-- ---------------------------------------------------------------------------
create or replace function public.duplicate_test(
  p_test uuid, p_center uuid, p_as_template boolean default false, p_title text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_src public.tests%rowtype;
  v_new uuid;
begin
  select * into v_src from public.tests where id = p_test;
  if not found or not public.can_read_test(p_test) then
    raise exception 'ZG_FORBIDDEN' using errcode = '42501';
  end if;
  if p_center is null then
    if not (public.is_hq_admin() and p_as_template) then
      raise exception 'ZG_FORBIDDEN' using errcode = '42501';
    end if;
  elsif not public.has_center_access(p_center) then
    raise exception 'ZG_FORBIDDEN' using errcode = '42501';
  end if;

  insert into public.tests (center_id, is_template, title, subject_id, grade, language, instructions,
                            question_count, negative_marking, negative_points, passing_score,
                            time_limit_minutes, status, source_test_id, created_by)
  values (p_center, p_as_template or p_center is null,
          left(coalesce(nullif(trim(p_title), ''), v_src.title), 200),
          v_src.subject_id, v_src.grade, v_src.language, v_src.instructions, v_src.question_count,
          v_src.negative_marking, v_src.negative_points, v_src.passing_score, v_src.time_limit_minutes,
          'draft', v_src.id, auth.uid())
  returning id into v_new;

  insert into public.test_questions (test_id, position, question_type, prompt, points)
  select v_new, q.position, q.question_type, q.prompt, q.points
  from public.test_questions q where q.test_id = p_test;

  insert into public.answer_options (question_id, label, text)
  select nq.id, o.label, o.text
  from public.test_questions q
  join public.answer_options o on o.question_id = q.id
  join public.test_questions nq on nq.test_id = v_new and nq.position = q.position
  where q.test_id = p_test;

  insert into public.answer_keys (question_id, test_id, correct_label)
  select nq.id, v_new, k.correct_label
  from public.test_questions q
  join public.answer_keys k on k.question_id = q.id
  join public.test_questions nq on nq.test_id = v_new and nq.position = q.position
  where q.test_id = p_test;

  perform public.write_audit(p_center, auth.uid(), 'test.duplicated', 'test', v_new::text,
                             jsonb_build_object('source_test_id', p_test));
  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scoring. The single source of truth for scores.
--   correct answer   -> question points
--   wrong answer     -> -negative_points when negative marking is on, else 0
--   blank / invalid  -> 0
-- The total is clamped at 0. percentage = score / max_score * 100.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_result(p_result uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_r public.assessment_results%rowtype;
  v_t public.tests%rowtype;
  v_max numeric;
  v_score numeric;
begin
  select * into v_r from public.assessment_results where id = p_result;
  select * into v_t from public.tests where id = v_r.test_id;

  update public.result_answers ra
  set correct_label = k.correct_label,
      is_correct = ra.selected_label is not null and ra.selected_label = k.correct_label,
      points_awarded = case
        when ra.selected_label is null then 0
        when ra.selected_label = k.correct_label then q.points
        when v_t.negative_marking then -v_t.negative_points
        else 0 end
  from public.test_questions q
  join public.answer_keys k on k.question_id = q.id
  where ra.result_id = p_result and q.test_id = v_r.test_id and q.position = ra.question_position;

  select coalesce(sum(q.points), 0) into v_max from public.test_questions q where q.test_id = v_r.test_id;
  select greatest(0, coalesce(sum(points_awarded), 0)) into v_score
  from public.result_answers where result_id = p_result;

  update public.assessment_results r
  set correct_count   = s.correct,
      incorrect_count = s.incorrect,
      blank_count     = s.blank,
      score           = v_score,
      max_score       = v_max,
      percentage      = case when v_max > 0 then round(v_score / v_max * 100, 2) else 0 end,
      passed          = v_score >= v_t.passing_score
  from (
    select count(*) filter (where is_correct) as correct,
           count(*) filter (where selected_label is not null and not is_correct) as incorrect,
           count(*) filter (where selected_label is null) as blank
    from public.result_answers where result_id = p_result
  ) s
  where r.id = p_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_scan_result: called by the server (service role) after OMR.
-- p_recognized: [{ "position":1, "detected":["A"], "chosen":"A", "status":"ok",
--                  "confidence":0.93, "fill":{"A":0.81,"B":0.07,...} }, ...]
-- p_sheet_warnings: [{ "code":"blurry", "blocking":true }, ...]
-- ---------------------------------------------------------------------------
create or replace function public.create_scan_result(
  p_scan_job uuid, p_recognized jsonb, p_sheet_warnings jsonb default '[]'::jsonb, p_student uuid default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_job public.scan_jobs%rowtype;
  v_test public.tests%rowtype;
  v_sheet public.answer_sheets%rowtype;
  v_student uuid;
  v_class uuid;
  v_result uuid;
  v_warnings jsonb;
  v_blocking int;
begin
  select * into v_job from public.scan_jobs where id = p_scan_job for update;
  if not found then
    raise exception 'ZG_NOT_FOUND' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.assessment_results where scan_job_id = p_scan_job) then
    raise exception 'ZG_ALREADY_PROCESSED' using errcode = '23505';
  end if;
  select * into v_test from public.tests where id = v_job.test_id;
  if v_test.status <> 'published' then
    raise exception 'ZG_TEST_NOT_PUBLISHED' using errcode = '22023';
  end if;

  if v_job.answer_sheet_id is not null then
    select * into v_sheet from public.answer_sheets where id = v_job.answer_sheet_id;
  end if;
  v_student := coalesce(p_student, v_sheet.student_id);
  if v_student is not null then
    select s.class_id into v_class from public.students s
    where s.id = v_student and s.center_id = v_job.center_id;
    if not found then
      raise exception 'ZG_FORBIDDEN' using errcode = '42501';
    end if;
  end if;
  v_class := coalesce(v_sheet.class_id, v_class);

  insert into public.recognized_answers (scan_job_id, center_id, question_position, detected_labels,
                                         chosen_label, status, confidence, fill_levels)
  select p_scan_job, v_job.center_id, (e ->> 'position')::smallint,
         coalesce(array(select jsonb_array_elements_text(e -> 'detected')), '{}'),
         nullif(e ->> 'chosen', ''), e ->> 'status',
         least(1, greatest(0, coalesce((e ->> 'confidence')::numeric, 0))),
         coalesce(e -> 'fill', '{}'::jsonb)
  from jsonb_array_elements(p_recognized) e
  where (e ->> 'position')::int between 1 and v_test.question_count;

  select coalesce(jsonb_agg(w), '[]'::jsonb) into v_warnings from (
    select jsonb_build_object('code', ra.status, 'position', ra.question_position,
                              'blocking', ra.status in ('multiple', 'uncertain')) as w
    from public.recognized_answers ra
    where ra.scan_job_id = p_scan_job and ra.status <> 'ok'
    union all
    select jsonb_build_object('code', sw ->> 'code', 'blocking', coalesce((sw ->> 'blocking')::boolean, true))
    from jsonb_array_elements(coalesce(p_sheet_warnings, '[]'::jsonb)) sw
  ) x;
  select count(*) into v_blocking from jsonb_array_elements(v_warnings) w where (w ->> 'blocking')::boolean;
  if v_student is null then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'student_missing', 'blocking', true));
    v_blocking := v_blocking + 1;
  end if;

  insert into public.assessment_results (center_id, test_id, student_id, class_id, answer_sheet_id,
                                         scan_job_id, source, warnings, open_warning_count, status, created_by)
  values (v_job.center_id, v_job.test_id, v_student, v_class, v_job.answer_sheet_id, p_scan_job, 'scan',
          v_warnings, v_blocking, 'needs_review', v_job.uploaded_by)
  returning id into v_result;

  insert into public.result_answers (result_id, center_id, test_id, question_position,
                                     recognized_label, selected_label, recognition_status)
  select v_result, v_job.center_id, v_job.test_id, q.position,
         ra.chosen_label,
         case when ra.status in ('ok', 'uncertain') then ra.chosen_label else null end,
         coalesce(ra.status, 'uncertain')
  from public.test_questions q
  left join public.recognized_answers ra on ra.scan_job_id = p_scan_job and ra.question_position = q.position
  where q.test_id = v_job.test_id;

  perform public.recompute_result(v_result);
  update public.scan_jobs set status = 'needs_review', error_code = null, error_detail = null where id = p_scan_job;
  perform public.write_audit(v_job.center_id, v_job.uploaded_by, 'result.recognized', 'assessment_result',
                             v_result::text, jsonb_build_object('scan_job_id', p_scan_job, 'warnings', v_blocking));
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- review_result: teacher confirms / corrects answers. Every change is logged.
-- p_answers: {"1":"A","2":null,...} (only changed positions need to be sent)
-- ---------------------------------------------------------------------------
create or replace function public.review_result(
  p_result uuid, p_answers jsonb default '{}'::jsonb, p_student uuid default null, p_comment text default ''
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_r public.assessment_results%rowtype;
  v_entry record;
  v_pos int;
  v_new text;
  v_old text;
  v_changes int := 0;
  v_old_score numeric;
  v_student_class uuid;
  v_student_center uuid;
begin
  select * into v_r from public.assessment_results where id = p_result for update;
  if not found or not public.can_read_result(p_result) then
    raise exception 'ZG_FORBIDDEN' using errcode = '42501';
  end if;
  if v_r.status = 'finalized' then
    raise exception 'ZG_RESULT_FINALIZED' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_answers, '{}'::jsonb)) <> 'object' then
    raise exception 'ZG_INVALID_ANSWERS' using errcode = '22023';
  end if;
  v_old_score := v_r.score;

  for v_entry in select key, value from jsonb_each(coalesce(p_answers, '{}'::jsonb)) loop
    if v_entry.key !~ '^[0-9]{1,3}$' then
      raise exception 'ZG_INVALID_ANSWERS' using errcode = '22023';
    end if;
    v_pos := v_entry.key::int;
    v_new := case when jsonb_typeof(v_entry.value) = 'null' then null else v_entry.value #>> '{}' end;
    select selected_label into v_old from public.result_answers
    where result_id = p_result and question_position = v_pos;
    if not found then
      raise exception 'ZG_INVALID_ANSWERS' using errcode = '22023', detail = v_pos::text;
    end if;
    if v_new is not null and not exists (
      select 1 from public.test_questions q
      join public.answer_options o on o.question_id = q.id
      where q.test_id = v_r.test_id and q.position = v_pos and o.label = v_new
    ) then
      raise exception 'ZG_INVALID_ANSWERS' using errcode = '22023', detail = v_pos::text;
    end if;
    if v_new is distinct from v_old then
      update public.result_answers set selected_label = v_new
      where result_id = p_result and question_position = v_pos;
      insert into public.result_reviews (result_id, center_id, reviewer_id, action, question_position,
                                         previous_value, new_value, comment)
      values (p_result, v_r.center_id, auth.uid(), 'correction', v_pos, v_old, v_new, left(coalesce(p_comment, ''), 1000));
      v_changes := v_changes + 1;
    end if;
  end loop;

  if p_student is not null and p_student is distinct from v_r.student_id then
    select s.class_id, s.center_id into v_student_class, v_student_center from public.students s where s.id = p_student;
    if v_student_center is distinct from v_r.center_id or not public.can_access_student(p_student) then
      raise exception 'ZG_FORBIDDEN' using errcode = '42501';
    end if;
    update public.assessment_results
    set student_id = p_student, class_id = coalesce(v_r.class_id, v_student_class)
    where id = p_result;
    insert into public.result_reviews (result_id, center_id, reviewer_id, action, previous_value, new_value)
    values (p_result, v_r.center_id, auth.uid(), 'student_link', v_r.student_id::text, p_student::text);
  end if;

  if coalesce(p_student, v_r.student_id) is null then
    raise exception 'ZG_STUDENT_REQUIRED' using errcode = '22023';
  end if;

  perform public.recompute_result(p_result);
  update public.assessment_results
  set status = 'reviewed', open_warning_count = 0, reviewed_by = auth.uid(), reviewed_at = now(),
      correction_count = correction_count + v_changes
  where id = p_result
  returning * into v_r;

  insert into public.result_reviews (result_id, center_id, reviewer_id, action, previous_score, new_score, comment)
  values (p_result, v_r.center_id, auth.uid(), 'review', v_old_score, v_r.score, left(coalesce(p_comment, ''), 1000));
  if v_r.scan_job_id is not null then
    update public.scan_jobs set status = 'reviewed' where id = v_r.scan_job_id;
  end if;
  perform public.write_audit(v_r.center_id, auth.uid(), 'result.reviewed', 'assessment_result', p_result::text,
                             jsonb_build_object('corrections', v_changes, 'previous_score', v_old_score, 'new_score', v_r.score));
  return jsonb_build_object('score', v_r.score, 'max_score', v_r.max_score, 'percentage', v_r.percentage,
                            'corrections', v_changes);
end;
$$;

-- ---------------------------------------------------------------------------
-- finalize_result / reopen_result
-- ---------------------------------------------------------------------------
create or replace function public.can_finalize_in_center(p_center uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_center_admin(p_center) or exists (
    select 1 from public.center_memberships m
    join public.centers c on c.id = m.center_id
    join public.profiles p on p.id = m.user_id
    where m.user_id = auth.uid() and m.center_id = p_center and m.role = 'teacher'
      and m.can_finalize and m.is_active and c.is_active and p.is_active
  );
$$;

create or replace function public.finalize_result(p_result uuid, p_comment text default '')
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_r public.assessment_results%rowtype;
begin
  select * into v_r from public.assessment_results where id = p_result for update;
  if not found or not public.can_read_result(p_result) or not public.can_finalize_in_center(v_r.center_id) then
    raise exception 'ZG_FORBIDDEN' using errcode = '42501';
  end if;
  if v_r.status = 'finalized' then
    raise exception 'ZG_RESULT_FINALIZED' using errcode = '42501';
  end if;
  -- Uncertain recognition can never be finalized without a human review.
  if not (v_r.status = 'reviewed' or (v_r.status = 'needs_review' and v_r.open_warning_count = 0)) then
    raise exception 'ZG_REVIEW_REQUIRED' using errcode = '22023';
  end if;
  if v_r.student_id is null then
    raise exception 'ZG_STUDENT_REQUIRED' using errcode = '22023';
  end if;

  update public.assessment_results
  set status = 'finalized', finalized_by = auth.uid(), finalized_at = now(),
      reviewed_by = coalesce(reviewed_by, auth.uid()), reviewed_at = coalesce(reviewed_at, now())
  where id = p_result;
  if v_r.scan_job_id is not null then
    update public.scan_jobs set status = 'finalized' where id = v_r.scan_job_id;
  end if;
  insert into public.result_reviews (result_id, center_id, reviewer_id, action, previous_score, new_score, comment)
  values (p_result, v_r.center_id, auth.uid(), 'finalize', v_r.score, v_r.score, left(coalesce(p_comment, ''), 1000));
  perform public.write_audit(v_r.center_id, auth.uid(), 'result.finalized', 'assessment_result', p_result::text,
                             jsonb_build_object('score', v_r.score, 'percentage', v_r.percentage));
end;
$$;

create or replace function public.reopen_result(p_result uuid, p_comment text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_r public.assessment_results%rowtype;
begin
  select * into v_r from public.assessment_results where id = p_result for update;
  if not found or not public.is_center_admin(v_r.center_id) then
    raise exception 'ZG_FORBIDDEN' using errcode = '42501';
  end if;
  if v_r.status <> 'finalized' then
    raise exception 'ZG_INVALID_STATUS' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_comment, ''))) < 3 then
    raise exception 'ZG_COMMENT_REQUIRED' using errcode = '22023';
  end if;
  update public.assessment_results
  set status = 'reviewed', finalized_by = null, finalized_at = null
  where id = p_result;
  if v_r.scan_job_id is not null then
    update public.scan_jobs set status = 'reviewed' where id = v_r.scan_job_id;
  end if;
  insert into public.result_reviews (result_id, center_id, reviewer_id, action, previous_score, new_score, comment)
  values (p_result, v_r.center_id, auth.uid(), 'reopen', v_r.score, v_r.score, left(p_comment, 1000));
  perform public.write_audit(v_r.center_id, auth.uid(), 'result.reopened', 'assessment_result', p_result::text,
                             jsonb_build_object('comment', left(p_comment, 200)));
end;
$$;

-- ---------------------------------------------------------------------------
-- create_manual_result: answers typed in by a teacher (e.g. when a photo is
-- unusable). Scored by the same function; status 'reviewed'.
-- ---------------------------------------------------------------------------
create or replace function public.create_manual_result(p_test uuid, p_student uuid, p_answers jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_test public.tests%rowtype;
  v_student public.students%rowtype;
  v_result uuid;
  v_entry record;
  v_pos int;
  v_val text;
begin
  select * into v_test from public.tests where id = p_test;
  select * into v_student from public.students where id = p_student;
  if v_test.id is null or v_student.id is null or v_test.center_id is null
     or v_test.center_id <> v_student.center_id
     or not public.can_read_test(p_test) or not public.can_access_student(p_student) then
    raise exception 'ZG_FORBIDDEN' using errcode = '42501';
  end if;
  if v_test.status <> 'published' then
    raise exception 'ZG_TEST_NOT_PUBLISHED' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_answers, '{}'::jsonb)) <> 'object' then
    raise exception 'ZG_INVALID_ANSWERS' using errcode = '22023';
  end if;

  insert into public.assessment_results (center_id, test_id, student_id, class_id, source, status,
                                         created_by, reviewed_by, reviewed_at)
  values (v_test.center_id, p_test, p_student, v_student.class_id, 'manual', 'reviewed',
          auth.uid(), auth.uid(), now())
  returning id into v_result;

  insert into public.result_answers (result_id, center_id, test_id, question_position, selected_label)
  select v_result, v_test.center_id, p_test, q.position, null
  from public.test_questions q where q.test_id = p_test;

  for v_entry in select key, value from jsonb_each(coalesce(p_answers, '{}'::jsonb)) loop
    if v_entry.key !~ '^[0-9]{1,3}$' then
      raise exception 'ZG_INVALID_ANSWERS' using errcode = '22023';
    end if;
    v_pos := v_entry.key::int;
    v_val := case when jsonb_typeof(v_entry.value) = 'null' then null else v_entry.value #>> '{}' end;
    if v_val is not null and not exists (
      select 1 from public.test_questions q join public.answer_options o on o.question_id = q.id
      where q.test_id = p_test and q.position = v_pos and o.label = v_val
    ) then
      raise exception 'ZG_INVALID_ANSWERS' using errcode = '22023', detail = v_pos::text;
    end if;
    update public.result_answers set selected_label = v_val
    where result_id = v_result and question_position = v_pos;
    if not found then
      raise exception 'ZG_INVALID_ANSWERS' using errcode = '22023', detail = v_pos::text;
    end if;
  end loop;

  perform public.recompute_result(v_result);
  perform public.write_audit(v_test.center_id, auth.uid(), 'result.manual_created', 'assessment_result',
                             v_result::text, '{}'::jsonb);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Analytics (SECURITY INVOKER: RLS decides which results are counted).
-- Only finalized results are included.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_overview(
  p_center uuid default null, p_class uuid default null, p_subject uuid default null,
  p_test uuid default null, p_from timestamptz default null, p_to timestamptz default null
)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_from timestamptz := coalesce(p_from, now() - interval '365 days');
  v_to timestamptz := coalesce(p_to, now());
  v_len interval;
  v_out jsonb;
begin
  v_len := v_to - v_from;

  with base as (
    select r.id, r.center_id, r.class_id, r.student_id, r.test_id, r.percentage, r.score, r.passed,
           r.submitted_at, t.subject_id, t.title
    from public.assessment_results r
    join public.tests t on t.id = r.test_id
    where r.status = 'finalized'
      and (p_center is null or r.center_id = p_center)
      and (p_class is null or r.class_id = p_class)
      and (p_subject is null or t.subject_id = p_subject)
      and (p_test is null or r.test_id = p_test)
  ),
  cur as (select * from base where submitted_at >= v_from and submitted_at < v_to),
  prev as (select * from base where submitted_at >= v_from - v_len and submitted_at < v_from)
  select jsonb_build_object(
    'results_count', (select count(*) from cur),
    'tests_count', (select count(distinct test_id) from cur),
    'students_count', (select count(distinct student_id) from cur),
    'avg_percentage', (select round(avg(percentage), 2) from cur),
    'pass_rate', (select round(avg(case when passed then 100 else 0 end), 2) from cur),
    'previous', jsonb_build_object(
      'results_count', (select count(*) from prev),
      'avg_percentage', (select round(avg(percentage), 2) from prev),
      'pass_rate', (select round(avg(case when passed then 100 else 0 end), 2) from prev)),
    'by_subject', coalesce((
      select jsonb_agg(x order by x ->> 'name_ru') from (
        select jsonb_build_object('subject_id', s.id, 'name_kk', s.name_kk, 'name_ru', s.name_ru,
                                  'avg', round(avg(c.percentage), 2), 'n', count(*)) as x
        from cur c join public.subjects s on s.id = c.subject_id
        group by s.id, s.name_kk, s.name_ru) q), '[]'::jsonb),
    'by_class', coalesce((
      select jsonb_agg(x order by x ->> 'name') from (
        select jsonb_build_object('class_id', cl.id, 'name', cl.name,
                                  'avg', round(avg(c.percentage), 2), 'n', count(*)) as x
        from cur c join public.classes cl on cl.id = c.class_id
        group by cl.id, cl.name) q), '[]'::jsonb),
    'by_center', coalesce((
      select jsonb_agg(x order by x ->> 'name') from (
        select jsonb_build_object('center_id', ce.id, 'name', ce.name,
                                  'avg', round(avg(c.percentage), 2), 'n', count(*),
                                  'students', count(distinct c.student_id)) as x
        from cur c join public.centers ce on ce.id = c.center_id
        group by ce.id, ce.name) q), '[]'::jsonb),
    'distribution', (
      select jsonb_agg(jsonb_build_object('bucket', b, 'n',
               (select count(*) from cur where least(9, floor(percentage / 10)::int) = b)) order by b)
      from generate_series(0, 9) b),
    'by_month', coalesce((
      select jsonb_agg(x order by x ->> 'month') from (
        select jsonb_build_object('month', to_char(date_trunc('month', submitted_at), 'YYYY-MM'),
                                  'avg', round(avg(percentage), 2), 'n', count(*)) as x
        from cur group by date_trunc('month', submitted_at)) q), '[]'::jsonb),
    'difficult_questions', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('test_id', c.test_id, 'title', min(c.title), 'position', ra.question_position,
                                  'correct_rate', round(avg(case when ra.is_correct then 100 else 0 end), 1),
                                  'n', count(*)) as x
        from cur c join public.result_answers ra on ra.result_id = c.id
        group by c.test_id, ra.question_position
        having count(*) >= 1
        order by avg(case when ra.is_correct then 1 else 0 end) asc, count(*) desc
        limit 10) q), '[]'::jsonb),
    'common_wrong', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('test_id', c.test_id, 'title', min(c.title), 'position', ra.question_position,
                                  'label', ra.selected_label, 'correct_label', min(ra.correct_label),
                                  'n', count(*)) as x
        from cur c join public.result_answers ra on ra.result_id = c.id
        where ra.selected_label is not null and not ra.is_correct
        group by c.test_id, ra.question_position, ra.selected_label
        order by count(*) desc
        limit 10) q), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges: nothing is executable by default.
-- ---------------------------------------------------------------------------
-- Supabase's default privileges grant EXECUTE on new functions directly to
-- anon, authenticated and service_role, so revoking from PUBLIC is not enough.
revoke execute on all functions in schema public from public, anon, authenticated, service_role;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant execute on function public.is_hq_admin() to authenticated, service_role;
grant execute on function public.has_center_access(uuid) to authenticated, service_role;
grant execute on function public.is_center_admin(uuid) to authenticated, service_role;
grant execute on function public.is_teacher_of_class(uuid) to authenticated, service_role;
grant execute on function public.can_access_class(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_access_student(uuid) to authenticated, service_role;
grant execute on function public.can_read_test(uuid) to authenticated, service_role;
grant execute on function public.can_read_test_row(uuid, uuid, boolean, text, uuid) to authenticated, service_role;
grant execute on function public.can_edit_test(uuid) to authenticated, service_role;
grant execute on function public.can_read_result_row(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.can_read_result(uuid) to authenticated, service_role;
grant execute on function public.can_read_scan_job(uuid) to authenticated, service_role;
grant execute on function public.shares_center_with(uuid) to authenticated, service_role;
grant execute on function public.can_finalize_in_center(uuid) to authenticated, service_role;
grant execute on function public.can_read_file(uuid) to authenticated, service_role;

grant execute on function public.save_test_content(uuid, jsonb) to authenticated;
grant execute on function public.publish_test(uuid) to authenticated;
grant execute on function public.duplicate_test(uuid, uuid, boolean, text) to authenticated;
grant execute on function public.review_result(uuid, jsonb, uuid, text) to authenticated;
grant execute on function public.finalize_result(uuid, text) to authenticated;
grant execute on function public.reopen_result(uuid, text) to authenticated;
grant execute on function public.create_manual_result(uuid, uuid, jsonb) to authenticated;
grant execute on function public.analytics_overview(uuid, uuid, uuid, uuid, timestamptz, timestamptz) to authenticated;

-- Server-only (called with the service-role key after authorization checks).
grant execute on function public.create_scan_result(uuid, jsonb, jsonb, uuid) to service_role;
grant execute on function public.recompute_result(uuid) to service_role;
grant execute on function public.write_audit(uuid, uuid, text, text, text, jsonb) to service_role;


-- ===== supabase/migrations/20261014000004_storage.sql =====
-- ============================================================================
-- ZerdeliGrade: private storage for answer-sheet photos
--
-- The bucket is private and has NO policies for the anon or authenticated
-- roles, so browsers can never read, list or upload objects directly.
-- The Next.js server uploads with the service-role key after checking the
-- user's permissions, and hands out short-lived signed URLs only to users who
-- can read the matching file_metadata row through RLS.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('answer-sheets', 'answer-sheets', false, 15728640, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ===== supabase/migrations/20261014000005_reference_data.sql =====
-- Reference data (not demo data): the network-wide subject dictionary.
-- HQ can edit or extend it in Settings -> Subjects.
insert into public.subjects (code, name_kk, name_ru) values
  ('math',       'Математика',            'Математика'),
  ('algebra',    'Алгебра',               'Алгебра'),
  ('geometry',   'Геометрия',             'Геометрия'),
  ('physics',    'Физика',                'Физика'),
  ('chemistry',  'Химия',                 'Химия'),
  ('biology',    'Биология',              'Биология'),
  ('geography',  'География',             'География'),
  ('history_kz', 'Қазақстан тарихы',      'История Казахстана'),
  ('world_history', 'Дүниежүзі тарихы',   'Всемирная история'),
  ('kazakh',     'Қазақ тілі',            'Казахский язык'),
  ('kazakh_lit', 'Қазақ әдебиеті',        'Казахская литература'),
  ('russian',    'Орыс тілі',             'Русский язык'),
  ('russian_lit','Орыс әдебиеті',         'Русская литература'),
  ('english',    'Ағылшын тілі',          'Английский язык'),
  ('informatics','Информатика',           'Информатика'),
  ('math_literacy', 'Математикалық сауаттылық', 'Математическая грамотность'),
  ('reading_literacy', 'Оқу сауаттылығы', 'Грамотность чтения'),
  ('primary',    'Бастауыш сынып',        'Начальные классы')
on conflict (code) do nothing;


-- ===== supabase/migrations/20261014000006_void_results.sql =====
-- ============================================================================
-- ZerdeliGrade: voiding (annulling) results
--
-- A wrong result (wrong sheet photographed, spoiled photo, wrong test) is not
-- deleted: it is marked 'voided' with a reason. It disappears from lists,
-- analytics and exports, the answer sheet is released so it can be scanned
-- again, the photo is scheduled for immediate deletion, and the audit trail
-- keeps who voided it and why.
--
-- Rules:
--   * not finalized: anyone who can read the result (its teacher, center admin)
--   * finalized:     center admins (and HQ) only
--   * a reason (>= 3 characters) is always required
-- ============================================================================

alter table public.assessment_results drop constraint assessment_results_status_check;
alter table public.assessment_results add constraint assessment_results_status_check
  check (status in ('uploaded', 'processing', 'needs_review', 'reviewed', 'finalized', 'failed', 'voided'));

alter table public.scan_jobs drop constraint scan_jobs_status_check;
alter table public.scan_jobs add constraint scan_jobs_status_check
  check (status in ('uploaded', 'processing', 'needs_review', 'reviewed', 'finalized', 'failed', 'voided'));

alter table public.result_reviews drop constraint result_reviews_action_check;
alter table public.result_reviews add constraint result_reviews_action_check
  check (action in ('correction', 'review', 'finalize', 'reopen', 'student_link', 'void'));

alter table public.assessment_results
  add column if not exists voided_by   uuid references public.profiles (id) on delete set null,
  add column if not exists voided_at   timestamptz,
  add column if not exists void_reason text check (char_length(void_reason) <= 1000);

create or replace function public.void_result(p_result uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_r public.assessment_results%rowtype;
  v_file uuid;
begin
  select * into v_r from public.assessment_results where id = p_result for update;
  if not found or not public.can_read_result(p_result) then
    raise exception 'ZG_FORBIDDEN' using errcode = '42501';
  end if;
  if v_r.status = 'voided' then
    raise exception 'ZG_RESULT_VOIDED' using errcode = '22023';
  end if;
  if v_r.status = 'finalized' and not public.is_center_admin(v_r.center_id) then
    raise exception 'ZG_FORBIDDEN' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'ZG_COMMENT_REQUIRED' using errcode = '22023';
  end if;

  -- answer_sheet_id is cleared so the same paper sheet can be scanned again.
  update public.assessment_results
  set status = 'voided', voided_by = auth.uid(), voided_at = now(), void_reason = left(trim(p_reason), 1000),
      answer_sheet_id = null, open_warning_count = 0
  where id = p_result;

  if v_r.scan_job_id is not null then
    update public.scan_jobs set status = 'voided' where id = v_r.scan_job_id returning file_id into v_file;
    -- The photo is no longer needed: due for deletion now (the server and the
    -- retention job remove it from storage).
    if v_file is not null then
      update public.file_metadata set delete_after = now() where id = v_file and deleted_at is null;
    end if;
  end if;

  insert into public.result_reviews (result_id, center_id, reviewer_id, action, previous_value, new_value,
                                     previous_score, new_score, comment)
  values (p_result, v_r.center_id, auth.uid(), 'void', v_r.status, 'voided', v_r.score, v_r.score,
          left(trim(p_reason), 1000));
  perform public.write_audit(v_r.center_id, auth.uid(), 'result.voided', 'assessment_result', p_result::text,
                             jsonb_build_object('reason', left(trim(p_reason), 200), 'previous_status', v_r.status,
                                                'answer_sheet_id', v_r.answer_sheet_id, 'score', v_r.score));
end;
$$;

-- A voided result can no longer be reviewed.
create or replace function public.reject_voided_review()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.status = 'voided' and new.status <> 'voided' then
    raise exception 'ZG_RESULT_VOIDED' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger assessment_results_voided_final before update on public.assessment_results
  for each row execute function public.reject_voided_review();

revoke execute on function public.void_result(uuid, text) from public, anon;
revoke execute on function public.reject_voided_review() from public, anon, authenticated;
grant execute on function public.void_result(uuid, text) to authenticated;

-- Tell PostgREST about the new function/columns.
notify pgrst, 'reload schema';


-- ===== supabase/migrations/20261014000007_access_requests.sql =====
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


-- ===== supabase/migrations/20261016000008_sheet_paper_size.sql =====
-- ============================================================================
-- ZerdeliGrade: answer-sheet paper size (A4, or A5 printed two per A4 page).
-- Existing sheets are A4. A5 holds at most 40 questions.
-- ============================================================================

alter table public.answer_sheets
  add column if not exists paper_size text not null default 'a4' check (paper_size in ('a4', 'a5'));

alter table public.answer_sheets drop constraint if exists answer_sheets_a5_question_limit;
alter table public.answer_sheets add constraint answer_sheets_a5_question_limit
  check (paper_size <> 'a5' or question_count <= 40);

notify pgrst, 'reload schema';

