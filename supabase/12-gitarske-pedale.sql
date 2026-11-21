-- BisStage: nova kategorija u ocjenama opreme "Gitarske pedale i pojačala".
-- Pokreni u Supabaseu: SQL Editor -> New query -> zalijepi -> Run. Smije se pokrenuti i više puta.

alter table public.oprema drop constraint if exists oprema_kategorija_check;
alter table public.oprema add constraint oprema_kategorija_check check (kategorija in
  ('Gitare i basovi','Gitarske pedale i pojačala','Bubnjevi i udaraljke','Klavijature','Gudački','Puhački','Tamburice','Ozvučenje','Studijska oprema'));
