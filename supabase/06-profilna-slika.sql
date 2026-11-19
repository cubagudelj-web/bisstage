-- BisStage: profilna slika korisnika
-- Pokreni jednom u Supabaseu: SQL Editor -> New query -> zalijepi -> Run.

alter table public.profili add column slika text check (
  slika is null or (slika ~ '^[0-9a-f-]{36}/profil/[0-9a-f-]{36}\.jpg$' and split_part(slika, '/', 1) = id::text)
);
grant update (slika) on public.profili to authenticated;
