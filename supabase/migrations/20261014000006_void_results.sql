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
