-- Create extension if not exists
create extension if not exists "uuid-ossp";

-- App configuration (API keys, settings)
create table if not exists public.app_config (
  key text primary key,
  value text not null,
  created_at timestamptz not null default now()
);

alter table public.app_config enable row level security;
create policy "anon can read app_config" on public.app_config for select to anon using (true);

-- Create tables
create table if not exists public.grammar_rules (
  id uuid primary key default uuid_generate_v4(),
  category text not null unique,
  title text not null,
  icon text,
  rules jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default uuid_generate_v4(),
  category text not null references public.grammar_rules(category) on delete cascade,
  sentence text not null,
  correct_answer text not null,
  options jsonb not null,
  explanation text,
  translations jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Enable RLS
alter table public.grammar_rules enable row level security;
alter table public.questions enable row level security;

-- Policies (Simplified syntax)
create policy "anon can read grammar rules" on public.grammar_rules for select to anon using (true);
create policy "anon can read questions" on public.questions for select to anon using (true);
create policy "anon can delete answered question" on public.questions for delete to anon using (true);
create policy "anon can insert grammar rules" on public.grammar_rules for insert to anon with check (true);
create policy "anon can insert questions" on public.questions for insert to anon with check (true);
create policy "service role upserts rules" on public.grammar_rules for insert to service_role with check (true);
create policy "service role upserts questions" on public.questions for insert to service_role with check (true);

-- Gemini API usage logs
create table if not exists public.gemini_logs (
  id uuid primary key default uuid_generate_v4(),
  action text not null,           -- 'generate_questions' | 'create_category'
  category text,
  model text not null,
  prompt_tokens int not null default 0,
  response_tokens int not null default 0,
  total_tokens int not null default 0,
  questions_generated int not null default 0,
  success boolean not null default true,
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.gemini_logs enable row level security;
create policy "anon can read gemini_logs" on public.gemini_logs for select to anon using (true);
create policy "anon can insert gemini_logs" on public.gemini_logs for insert to anon with check (true);