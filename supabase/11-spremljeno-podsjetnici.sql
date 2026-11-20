-- BisStage: spremljeni oglasi, spremljene pretrage s obavijestima e-poštom,
-- podsjetnik prije isteka oglasa.
-- Pokreni jednom u Supabaseu: SQL Editor -> New query -> zalijepi -> Run.
-- E-pošta se šalje istim ključem iz Vaulta ("resend_api_key") kao obavijesti o odgovorima.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- Zajednička funkcija za slanje e-pošte (nedostupna sa stranice).
create function public.posalji_email(p_to text, p_subject text, p_html text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  if v_key is null or p_to is null then return; end if;
  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object('from', 'BisStage <noreply@bisstage.com>', 'to', jsonb_build_array(p_to),
      'subject', p_subject, 'html', p_html));
end $$;
revoke all on function public.posalji_email(text, text, text) from public, anon, authenticated;

create function public.norm(t text) returns text language sql immutable as $$
  select translate(lower(coalesce(t, '')), 'čćžšđČĆŽŠĐ', 'cczsdcczsd')
$$;

-- Postavka: obavijesti o novim oglasima za spremljene pretrage.
alter table public.postavke add column obavijesti_pretrage boolean not null default true;
grant insert (obavijesti_pretrage), update (obavijesti_pretrage) on public.postavke to authenticated;

-- 1. Spremljeni oglasi (vidi samo vlasnik).
create table public.spremljeni (
  autor uuid not null default auth.uid() references public.profili (id) on delete cascade,
  oglas uuid not null references public.oglasi (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (autor, oglas)
);
alter table public.spremljeni enable row level security;
create policy "spremljeni: samo svoje" on public.spremljeni for all to authenticated
  using (autor = (select auth.uid())) with check (autor = (select auth.uid()));
revoke all on public.spremljeni from anon, authenticated;
grant select, delete on public.spremljeni to authenticated;
grant insert (oglas) on public.spremljeni to authenticated;

-- 2. Spremljene pretrage (najviše 10 po korisniku).
create table public.pretrage (
  id uuid primary key default gen_random_uuid(),
  autor uuid not null default auth.uid() references public.profili (id) on delete cascade,
  q text not null default '' check (char_length(q) <= 80),
  kategorija text check (kategorija is null or kategorija in ('Gitare i basovi','Bubnjevi i udaraljke','Klavijature','Gudački','Puhački','Tamburice','Ozvučenje','Studijska oprema')),
  drzava text check (drzava is null or drzava in ('Hrvatska','Slovenija','Bosna i Hercegovina','Srbija','Crna Gora','Sjeverna Makedonija')),
  zadnja_obavijest timestamptz,
  created_at timestamptz not null default now(),
  check (q <> '' or kategorija is not null or drzava is not null)
);
create index on public.pretrage (autor);
alter table public.pretrage enable row level security;
create policy "pretrage: samo svoje" on public.pretrage for all to authenticated
  using (autor = (select auth.uid())) with check (autor = (select auth.uid()));
revoke all on public.pretrage from anon, authenticated;
grant select, delete on public.pretrage to authenticated;
grant insert (q, kategorija, drzava) on public.pretrage to authenticated;

create function public.najvise_pretraga() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.pretrage where autor = new.autor) >= 10 then
    raise exception 'Možeš spremiti najviše 10 pretraga. Izbriši neku u Moj račun.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger najvise_pretraga before insert on public.pretrage for each row execute function public.najvise_pretraga();

-- Obavijest kad se pojavi oglas koji odgovara nečijoj spremljenoj pretrazi
-- (najviše jedna e-poruka na sat po pretrazi, najviše 50 primatelja po oglasu).
create function public.obavijest_novi_oglas() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_txt text := public.norm(new.naslov || ' ' || new.opis || ' ' || new.grad);
  v_cijena text := case when new.cijena is null then 'Po dogovoru'
    else trim(to_char(new.cijena, 'FM999G999G990D')) || ' ' || case new.valuta when 'EUR' then '€' else new.valuta end end;
begin
  for r in
    select distinct on (p.autor) p.id, u.email
    from public.pretrage p join auth.users u on u.id = p.autor
    where p.autor <> new.autor
      and (p.kategorija is null or p.kategorija = new.kategorija)
      and (p.drzava is null or p.drzava = new.drzava)
      and (p.zadnja_obavijest is null or p.zadnja_obavijest < now() - interval '1 hour')
      and not exists (select 1 from public.postavke s where s.id = p.autor and not s.obavijesti_pretrage)
      and not exists (select 1 from unnest(regexp_split_to_array(trim(public.norm(p.q)), '\s+')) w
                      where w <> '' and position(w in v_txt) = 0)
    order by p.autor
    limit 50
  loop
    perform public.posalji_email(r.email, 'Novi oglas: ' || left(new.naslov, 80), format(
      '<div style="font-family:Arial,sans-serif;max-width:560px">'
      '<p>Na BisStageu je objavljen novi oglas koji odgovara tvojoj spremljenoj pretrazi:</p>'
      '<p style="font-size:18px;margin:12px 0"><strong>%s</strong><br>%s · %s, %s</p>'
      '<p><a href="https://bisstage.com/oglas/%s" style="color:#2a2fd6">Pogledaj oglas</a></p>'
      '<p style="color:#666;font-size:12px">Spremljene pretrage i ove obavijesti možeš urediti u Moj račun na bisstage.com.</p></div>',
      public.html_esc(new.naslov), public.html_esc(v_cijena), public.html_esc(new.grad), public.html_esc(new.drzava), new.id));
    update public.pretrage set zadnja_obavijest = now() where id = r.id;
  end loop;
  return new;
exception when others then
  return new; -- obavijest nikad ne smije spriječiti objavu oglasa
end $$;
revoke all on function public.obavijest_novi_oglas() from public, anon, authenticated;
create trigger obavijest_novi_oglas after insert on public.oglasi for each row execute function public.obavijest_novi_oglas();

-- 3. Podsjetnik tri dana prije isteka oglasa (svaki dan u 9 sati po našem vremenu).
alter table public.oglasi add column podsjetnik timestamptz;

create or replace function public.produlji_oglas(objekt uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_do timestamptz;
begin
  update public.oglasi set istjece = now() + interval '60 days', prodano = false, podsjetnik = null
    where id = objekt and (autor = auth.uid() or public.je_admin())
    returning istjece into v_do;
  if v_do is null then
    raise exception 'Možeš produljiti samo svoj oglas.' using errcode = '42501';
  end if;
  return v_do;
end $$;

create function public.podsjetnik_isteka() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in
    select o.id, o.naslov, o.istjece, u.email
    from public.oglasi o join auth.users u on u.id = o.autor
    where not o.prodano and o.podsjetnik is null
      and o.istjece > now() and o.istjece < now() + interval '3 days'
    limit 200
  loop
    perform public.posalji_email(r.email, 'Tvoj oglas uskoro ističe: ' || left(r.naslov, 70), format(
      '<div style="font-family:Arial,sans-serif;max-width:560px">'
      '<p>Tvoj oglas <strong>„%s”</strong> na BisStageu ističe <strong>%s</strong> i nakon toga se više neće prikazivati.</p>'
      '<p>Ako je predmet još na prodaju, otvori oglas i klikni <strong>Produlji za 60 dana</strong>. Ako je prodan, označi ga kao prodan.</p>'
      '<p><a href="https://bisstage.com/oglas/%s" style="color:#2a2fd6">Otvori oglas</a></p></div>',
      public.html_esc(r.naslov), to_char(r.istjece at time zone 'Europe/Zagreb', 'DD. MM. YYYY.'), r.id));
    update public.oglasi set podsjetnik = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.podsjetnik_isteka() from public, anon, authenticated;

select cron.schedule('bisstage-podsjetnik-isteka', '0 8 * * *', 'select public.podsjetnik_isteka()');
