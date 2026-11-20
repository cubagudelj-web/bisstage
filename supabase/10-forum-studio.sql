-- BisStage: kategorija foruma "Kućni studio" postaje "Studio i snimanje"
-- Pokreni jednom u Supabaseu: SQL Editor -> New query -> zalijepi -> Run.

alter table public.teme drop constraint teme_kategorija_check;
update public.teme set kategorija = 'Studio i snimanje' where kategorija = 'Kućni studio';
alter table public.teme add constraint teme_kategorija_check check (kategorija in
  ('Instrumenti','Bendovi i svirke','Studio i snimanje','Učenje i poduka','Razgovor'));
