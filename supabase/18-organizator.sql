-- BisStage: polje "Organizator" kod događaja (kad objavitelj nije organizator).
-- Pokreni u Supabaseu: SQL Editor -> New query -> zalijepi -> Run. Smije se pokrenuti i više puta.

alter table public.dogadaji add column if not exists izvor text;
alter table public.dogadaji drop constraint if exists dogadaji_izvor_check;
alter table public.dogadaji add constraint dogadaji_izvor_check check (izvor is null or char_length(izvor) between 1 and 120);
grant insert (izvor), update (izvor) on public.dogadaji to authenticated;
