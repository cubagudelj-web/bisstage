-- BisStage: kategorija "Gitarske pedale i pojačala" i u oglasniku (i u spremljenim pretragama).
-- Pokreni u Supabaseu: SQL Editor -> New query -> zalijepi -> Run. Smije se pokrenuti i više puta.

alter table public.oglasi drop constraint if exists oglasi_kategorija_check;
alter table public.oglasi add constraint oglasi_kategorija_check check (kategorija in
  ('Gitare i basovi','Gitarske pedale i pojačala','Bubnjevi i udaraljke','Klavijature','Gudački','Puhački','Tamburice','Ozvučenje','Studijska oprema'));

alter table public.pretrage drop constraint if exists pretrage_kategorija_check;
alter table public.pretrage add constraint pretrage_kategorija_check check (kategorija is null or kategorija in
  ('Gitare i basovi','Gitarske pedale i pojačala','Bubnjevi i udaraljke','Klavijature','Gudački','Puhački','Tamburice','Ozvučenje','Studijska oprema'));
