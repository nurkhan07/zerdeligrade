-- ZerdeliGrade update 003: A5 answer sheets (two per A4 page).
-- Run ONCE in Supabase -> SQL Editor (after updates 001 and 002).

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
