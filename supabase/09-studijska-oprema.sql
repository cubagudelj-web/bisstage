-- BisStage: kategorija "Kućni studio" postaje "Studijska oprema" (oglasi i ocjene opreme)
-- Pokreni jednom u Supabaseu: SQL Editor -> New query -> zalijepi -> Run.

alter table public.oglasi drop constraint oglasi_kategorija_check;
alter table public.oprema drop constraint oprema_kategorija_check;

update public.oglasi set kategorija = 'Studijska oprema' where kategorija = 'Kućni studio';
update public.oprema set kategorija = 'Studijska oprema' where kategorija = 'Kućni studio';

alter table public.oglasi add constraint oglasi_kategorija_check check (kategorija in
  ('Gitare i basovi','Bubnjevi i udaraljke','Klavijature','Gudački','Puhački','Tamburice','Ozvučenje','Studijska oprema'));
alter table public.oprema add constraint oprema_kategorija_check check (kategorija in
  ('Gitare i basovi','Bubnjevi i udaraljke','Klavijature','Gudački','Puhački','Tamburice','Ozvučenje','Studijska oprema'));
