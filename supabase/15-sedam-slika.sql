-- BisStage: oglas smije imati do 7 fotografija (do sada 4).
-- Pokreni u Supabaseu: SQL Editor -> New query -> zalijepi -> Run. Smije se pokrenuti i više puta.

alter table public.oglasi drop constraint if exists oglasi_slike_check;
alter table public.oglasi add constraint oglasi_slike_check check (cardinality(slike) <= 7);
