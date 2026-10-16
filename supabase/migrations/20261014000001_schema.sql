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
