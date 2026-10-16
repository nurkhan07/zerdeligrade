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
