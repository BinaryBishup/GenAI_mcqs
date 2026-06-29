-- 004 — per-seed expansion lineage.
--
-- Sample-mode generation now expands each source question into K variants
-- (item cloning), which preserves the bank's type/shape/difficulty mix by
-- construction. Record which sample each generated MCQ was cloned from, so the
-- UI can show provenance and the diversity check can group siblings.
--
-- Written best-effort (try/catch) so generation keeps working before this is
-- applied. Apply via the Supabase dashboard SQL editor or the Supabase MCP.

alter table mcqs add column if not exists parent_sample_id uuid;  -- samples.id this variant was cloned from (null = scratch/blend)
create index if not exists mcqs_parent_sample_idx on mcqs (parent_sample_id);
