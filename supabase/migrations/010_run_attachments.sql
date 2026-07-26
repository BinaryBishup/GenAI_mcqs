-- Attachment digests (extracted text, never the file) persist on the RUN that
-- was actually created from them, so reviewers can preview the source data.
-- The standalone scratch_docs library (009) is dropped: documents are not
-- stored unless the author goes through with a generation.
alter table runs add column if not exists attachments jsonb not null default '[]'::jsonb;

drop table if exists scratch_docs;
