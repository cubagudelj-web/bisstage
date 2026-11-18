-- BisStage: YouTube video u oglasima i fotografija opreme
-- Pokreni jednom u Supabaseu: SQL Editor -> New query -> zalijepi -> Run.

-- 1. Video u oglasu: sprema se samo YouTube oznaka videa (11 znakova), ne cijela poveznica.
alter table public.oglasi add column video text check (video is null or video ~ '^[A-Za-z0-9_-]{11}$');
grant select (video) on public.oglasi to anon;
grant insert (video), update (video) on public.oglasi to authenticated;

-- 2. Fotografija opreme: put u spremištu, uvijek u mapi autora.
alter table public.oprema add column slika text check (
  slika is null or (slika ~ '^[0-9a-f-]{36}/oprema/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$' and split_part(slika, '/', 1) = autor::text)
);
grant insert (id, slika), update (slika) on public.oprema to authenticated;

-- Pregled opreme treba novi stupac, pa ga slažemo ispočetka.
drop view public.oprema_pregled;
create view public.oprema_pregled with (security_invoker = true) as
  select o.*,
    count(r.id)::int as broj_ocjena,
    round(avg(r.zvuk), 2) as zvuk,
    round(avg(r.izrada), 2) as izrada,
    round(avg(r.vrijednost), 2) as vrijednost,
    round((avg(r.zvuk) + avg(r.izrada) + avg(r.vrijednost)) / 3, 2) as prosjek
  from public.oprema o left join public.recenzije r on r.oprema = o.id
  group by o.id;
grant select on public.oprema_pregled to anon, authenticated;
