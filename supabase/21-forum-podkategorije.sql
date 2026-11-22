-- BisStage: podkategorije foruma.
-- Pokreni u Supabaseu: SQL Editor -> New query -> zalijepi -> Run. Smije se pokrenuti i više puta.
-- Postojeće teme ostaju bez podkategorije (na stranici "Općenito"); premjestiti ih može autor ili administrator.

-- VAŽNO: ispravak dnevnog ograničenja objava iz 14-kalendari.sql. Zbog greške u njemu korisnici
-- (osim administratora) nisu mogli objavljivati oglase, poslove, teme, odgovore ni ocjene.
create or replace function public.ogranicenje_objava() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_novi boolean; v_granica int; v_broj int;
begin
  if public.je_admin() then return new; end if;
  if to_jsonb(new) ->> 'kalendar' is not null then return new; end if;
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

alter table public.teme add column if not exists podkategorija text;
alter table public.teme drop constraint if exists teme_podkategorija_check;
alter table public.teme add constraint teme_podkategorija_check check (podkategorija is null or podkategorija = any (case kategorija
  when 'Instrumenti' then array['Gitare i basovi','Pedale, pojačala i efekti','Bubnjevi i udaraljke','Klavijature','Tamburice','Gudački i puhački','Servis i održavanje']
  when 'Bendovi i svirke' then array['Traženje članova','Svadbe i privatne svirke','Klubovi i nastupi','Honorari i ugovori','Ozvučenje i rasvjeta']
  when 'Studio i snimanje' then array['Kućni studio','Mikrofoni i snimanje','Miks i mastering','Programi i dodaci (DAW, plugini)','Objava glazbe i autorska prava']
  when 'Učenje i poduka' then array['Početnici','Glazbena škola i akademija','Teorija i harmonija','Tehnika i vježbanje','Pjevanje']
  when 'Razgovor' then array['Koncerti i festivali','Nova glazba','Glazbena scena regije','Opušteno']
  else array[]::text[] end));
create index if not exists teme_kat_pod on public.teme (kategorija, podkategorija, created_at desc);
grant insert (podkategorija) on public.teme to authenticated;

-- Pregled tema mora znati za novi stupac.
drop view if exists public.teme_pregled;
create view public.teme_pregled with (security_invoker = true) as
  select t.*, (select count(*) from public.odgovori o where o.tema = t.id)::int as broj_odgovora
  from public.teme t;
grant select on public.teme_pregled to anon, authenticated;

-- Premještanje teme u drugu kategoriju ili podkategoriju (autor ili administrator).
create or replace function public.premjesti_temu(p_id uuid, p_kategorija text, p_podkategorija text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.teme set kategorija = p_kategorija, podkategorija = nullif(p_podkategorija, '')
    where id = p_id and (autor = auth.uid() or public.je_admin());
  if not found then
    raise exception 'Možeš premjestiti samo svoju temu.' using errcode = '42501';
  end if;
end $$;
revoke all on function public.premjesti_temu(uuid, text, text) from public, anon;
grant execute on function public.premjesti_temu(uuid, text, text) to authenticated;
