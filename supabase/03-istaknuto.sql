-- BisStage: istaknuti oglasi i poslovi
-- Pokreni jednom u Supabaseu: SQL Editor -> New query -> zalijepi -> Run.
--
-- Pravila (provjerava baza, ne samo stranica):
--   * korisnik ističe samo svoju objavu, uvijek na 7 dana;
--   * istodobno samo jedna istaknuta objava po korisniku u oglasima i jedna u poslovima;
--   * istu objavu ponovo može istaknuti tek 30 dana nakon prethodnog isticanja;
--   * administrator ističe bilo koju objavu na 1-90 dana ili uklanja isticanje (dana = 0).

alter table public.oglasi add column istaknut_od timestamptz, add column istaknut_do timestamptz;
alter table public.poslovi add column istaknut_od timestamptz, add column istaknut_do timestamptz;
create index on public.oglasi (istaknut_do desc);
create index on public.poslovi (istaknut_do desc);

-- Neprijavljeni smiju vidjeti je li objava istaknuta (prijavljeni već vide sve stupce).
grant select (istaknut_od, istaknut_do) on public.oglasi, public.poslovi to anon;
-- Namjerno NEMA grant update na ove stupce: mijenjaju se samo kroz funkciju ispod.

create or replace function public.istakni(tablica text, objekt uuid, dana int default 7)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_autor uuid; v_od timestamptz; v_do timestamptz; aktivnih int;
  v_admin boolean := public.je_admin();
begin
  if tablica not in ('oglasi', 'poslovi') then
    raise exception 'Nepoznata vrsta objave.' using errcode = 'P0001';
  end if;
  if auth.uid() is null then
    raise exception 'Za ovo se prvo prijavi.' using errcode = '42501';
  end if;

  execute format('select autor, istaknut_od, istaknut_do from public.%I where id = $1', tablica)
    into v_autor, v_od, v_do using objekt;
  if v_autor is null then
    raise exception 'Ova objava više ne postoji.' using errcode = 'P0001';
  end if;

  if not v_admin then
    if v_autor <> auth.uid() then
      raise exception 'Možeš istaknuti samo svoju objavu.' using errcode = '42501';
    end if;
    dana := 7;
    if v_do is not null and v_do > now() then
      raise exception 'Ova je objava već istaknuta.' using errcode = 'P0001';
    end if;
    if v_od is not null and v_od > now() - interval '30 days' then
      raise exception 'Istu objavu možeš ponovo istaknuti %', to_char(v_od + interval '30 days', 'DD. MM. YYYY.') using errcode = 'P0001';
    end if;
    execute format('select count(*) from public.%I where autor = $1 and istaknut_do > now()', tablica)
      into aktivnih using auth.uid();
    if aktivnih > 0 then
      raise exception 'Istodobno možeš imati samo jednu istaknutu objavu u ovom dijelu stranice.' using errcode = 'P0001';
    end if;
  end if;

  if dana <= 0 then
    execute format('update public.%I set istaknut_do = null where id = $1', tablica) using objekt;
    return null;
  end if;

  v_do := now() + make_interval(days => least(dana, 90));
  execute format('update public.%I set istaknut_od = now(), istaknut_do = $2 where id = $1', tablica) using objekt, v_do;
  return v_do;
end $$;

revoke all on function public.istakni(text, uuid, int) from public, anon;
grant execute on function public.istakni(text, uuid, int) to authenticated;
