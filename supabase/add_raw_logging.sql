-- Run this once in the Supabase SQL editor (project study_english) to enable
-- storing the full model request/response in the Generation History modal.
-- Safe to run multiple times.

alter table public.gemini_logs add column if not exists raw_request text;
alter table public.gemini_logs add column if not exists raw_response text;
