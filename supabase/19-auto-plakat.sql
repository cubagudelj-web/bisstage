-- BisStage: automatski BisStage plakat za događaje bez fotografije.
-- Pokreni u Supabaseu: SQL Editor -> New query -> zalijepi -> Run. Smije se pokrenuti i više puta.

alter table public.dogadaji add column if not exists plakat_auto boolean not null default false;
grant insert (plakat_auto), update (plakat_auto) on public.dogadaji to authenticated;
