-- BisStage: zaštita od spama (dnevna ograničenja), oznaka "Prodano" i istek oglasa
-- Pokreni jednom u Supabaseu: SQL Editor -> New query -> zalijepi -> Run.

-- 1. Dnevna ograničenja objava. Računi mlađi od 7 dana imaju strože granice.
--    Argumenti okidača: (granica za nove račune, granica za ostale) u zadnja 24 sata.
create function public.ogranicenje_objava() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_novi boolean; v_granica int; v_broj int;
begin
  if public.je_admin() then return new; end if;
  select created_at > now() - interval '7 days' into v_novi from public.profili where id = new.autor;
  v_granica := case when coalesce(v_novi, true) then tg_argv[0]::int else tg_argv[1]::int end;
  execute format('select count(*) from public.%I where autor = $1 and created_at > now() - interval ''24 hours''', tg_table_name)
    into v_broj using new.autor;
  if v_broj >= v_granica then
    raise exception 'Danas si dosegao najveći broj objava u ovom dijelu stranice (%). Pokušaj ponovo sutra.', v_granica
      using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.ogranicenje_objava() from public, anon, authenticated;

create trigger ogranicenje before insert on public.oglasi    for each row execute function public.ogranicenje_objava('5', '20');
create trigger ogranicenje before insert on public.poslovi   for each row execute function public.ogranicenje_objava('3', '10');
create trigger ogranicenje before insert on public.teme      for each row execute function public.ogranicenje_objava('5', '15');
create trigger ogranicenje before insert on public.odgovori  for each row execute function public.ogranicenje_objava('30', '100');
create trigger ogranicenje before insert on public.oprema    for each row execute function public.ogranicenje_objava('10', '30');
create trigger ogranicenje before insert on public.recenzije for each row execute function public.ogranicenje_objava('20', '50');
create trigger ogranicenje before insert on public.dogadaji  for each row execute function public.ogranicenje_objava('3', '10');
create trigger ogranicenje before insert on public.prijave   for each row execute function public.ogranicenje_objava('20', '50');

-- 2. Oglasi: oznaka "Prodano" i istek nakon 60 dana.
alter table public.oglasi
  add column prodano boolean not null default false,
  add column istjece timestamptz not null default now() + interval '60 days';
update public.oglasi set istjece = greatest(created_at + interval '60 days', now() + interval '14 days');
create index on public.oglasi (istjece);

grant select (prodano, istjece) on public.oglasi to anon;
grant update (prodano) on public.oglasi to authenticated;
-- istjece se ne mijenja izravno, nego samo kroz funkciju ispod.

create function public.produlji_oglas(objekt uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_do timestamptz;
begin
  update public.oglasi set istjece = now() + interval '60 days', prodano = false
    where id = objekt and (autor = auth.uid() or public.je_admin())
    returning istjece into v_do;
  if v_do is null then
    raise exception 'Možeš produljiti samo svoj oglas.' using errcode = '42501';
  end if;
  return v_do;
end $$;
revoke all on function public.produlji_oglas(uuid) from public, anon;
grant execute on function public.produlji_oglas(uuid) to authenticated;
