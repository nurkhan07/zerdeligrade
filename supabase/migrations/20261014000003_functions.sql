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
