-- BisStage: baza podataka i sigurnosna pravila
-- Pokreni jednom u Supabaseu: SQL Editor -> New query -> zalijepi cijelu datoteku -> Run.
--
-- Pravila ukratko:
--   * svi (i neprijavljeni) mogu čitati oglase, poslove, forum i ocjene;
--   * kontakt iz oglasa i poslova vide samo prijavljeni korisnici;
--   * objavljivati mogu samo prijavljeni, a mijenjati i brisati samo svoje;
--   * administrator (profili.admin = true) može brisati sve.

-- ---------------------------------------------------------------------------
-- Profili
-- ---------------------------------------------------------------------------
create table public.profili (
  id uuid primary key references auth.users (id) on delete cascade,
  ime text not null check (char_length(ime) between 1 and 60),
  admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profili enable row level security;

create policy "profili: svi čitaju" on public.profili
  for select using (true);
create policy "profili: svatko mijenja svoje ime" on public.profili
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

revoke insert, update, delete on public.profili from anon, authenticated;
grant update (ime) on public.profili to authenticated;

-- Novi korisnik automatski dobiva profil.
create function public.novi_korisnik() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profili (id, ime)
  values (
    new.id,
    left(coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'ime'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      split_part(new.email, '@', 1),
      'Glazbenik'
    ), 60)
  );
  return new;
end $$;

create trigger novi_korisnik_profil
  after insert on auth.users
  for each row execute function public.novi_korisnik();

create function public.je_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select admin from public.profili where id = auth.uid()), false)
$$;

-- ---------------------------------------------------------------------------
-- Oglasnik
-- ---------------------------------------------------------------------------
create table public.oglasi (
  id uuid primary key default gen_random_uuid(),
  autor uuid not null default auth.uid() references public.profili (id) on delete cascade,
  naslov text not null check (char_length(naslov) between 3 and 90),
  kategorija text not null check (kategorija in ('Gitare i basovi','Bubnjevi i udaraljke','Klavijature','Gudački','Puhački','Tamburice','Ozvučenje','Kućni studio')),
  stanje text not null check (stanje in ('Novo','Kao novo','Korišteno','Za popravak')),
  cijena numeric(12, 2) check (cijena >= 0),
  valuta text not null default 'EUR' check (valuta in ('EUR','KM','RSD','MKD')),
  grad text not null check (char_length(grad) between 1 and 60),
  drzava text not null check (drzava in ('Hrvatska','Slovenija','Bosna i Hercegovina','Srbija','Crna Gora','Sjeverna Makedonija')),
  opis text not null check (char_length(opis) between 1 and 3000),
  kontakt text not null check (char_length(kontakt) between 3 and 120),
  slike text[] not null default '{}' check (cardinality(slike) <= 4),
  created_at timestamptz not null default now()
);
create index on public.oglasi (created_at desc);

-- ---------------------------------------------------------------------------
-- Burza poslova
-- ---------------------------------------------------------------------------
create table public.poslovi (
  id uuid primary key default gen_random_uuid(),
  autor uuid not null default auth.uid() references public.profili (id) on delete cascade,
  naslov text not null check (char_length(naslov) between 3 and 90),
  vrsta text not null check (vrsta in ('Svirka','Stalni angažman','Studijsko snimanje','Poduka','Bend traži člana')),
  honorar text check (char_length(honorar) <= 40),
  grad text not null check (char_length(grad) between 1 and 60),
  drzava text not null check (drzava in ('Hrvatska','Slovenija','Bosna i Hercegovina','Srbija','Crna Gora','Sjeverna Makedonija')),
  rok date,
  opis text not null check (char_length(opis) between 1 and 3000),
  kontakt text not null check (char_length(kontakt) between 3 and 120),
  created_at timestamptz not null default now()
);
create index on public.poslovi (created_at desc);

-- ---------------------------------------------------------------------------
-- Forum
-- ---------------------------------------------------------------------------
create table public.teme (
  id uuid primary key default gen_random_uuid(),
  autor uuid not null default auth.uid() references public.profili (id) on delete cascade,
  naslov text not null check (char_length(naslov) between 3 and 120),
  kategorija text not null check (kategorija in ('Instrumenti','Bendovi i svirke','Kućni studio','Učenje i poduka','Razgovor')),
  tekst text not null check (char_length(tekst) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index on public.teme (created_at desc);

create table public.odgovori (
  id uuid primary key default gen_random_uuid(),
  tema uuid not null references public.teme (id) on delete cascade,
  autor uuid not null default auth.uid() references public.profili (id) on delete cascade,
  tekst text not null check (char_length(tekst) between 1 and 3000),
  created_at timestamptz not null default now()
);
create index on public.odgovori (tema, created_at);

-- ---------------------------------------------------------------------------
-- Ocjene opreme
-- ---------------------------------------------------------------------------
create table public.oprema (
  id uuid primary key default gen_random_uuid(),
  autor uuid not null default auth.uid() references public.profili (id) on delete cascade,
  naziv text not null check (char_length(naziv) between 2 and 90),
  kategorija text not null check (kategorija in ('Gitare i basovi','Bubnjevi i udaraljke','Klavijature','Gudački','Puhački','Tamburice','Ozvučenje','Kućni studio')),
  created_at timestamptz not null default now()
);
create unique index oprema_naziv_jedinstven on public.oprema (lower(naziv));

create table public.recenzije (
  id uuid primary key default gen_random_uuid(),
  oprema uuid not null references public.oprema (id) on delete cascade,
  autor uuid not null default auth.uid() references public.profili (id) on delete cascade,
  zvuk smallint not null check (zvuk between 1 and 5),
  izrada smallint not null check (izrada between 1 and 5),
  vrijednost smallint not null check (vrijednost between 1 and 5),
  tekst text not null check (char_length(tekst) between 1 and 3000),
  created_at timestamptz not null default now(),
  unique (oprema, autor)
);

-- ---------------------------------------------------------------------------
-- Pregledi za popise (broj odgovora, prosjek ocjena)
-- ---------------------------------------------------------------------------
create view public.teme_pregled with (security_invoker = true) as
  select t.*, (select count(*) from public.odgovori o where o.tema = t.id)::int as broj_odgovora
  from public.teme t;

create view public.oprema_pregled with (security_invoker = true) as
  select o.*,
    count(r.id)::int as broj_ocjena,
    round(avg(r.zvuk), 2) as zvuk,
    round(avg(r.izrada), 2) as izrada,
    round(avg(r.vrijednost), 2) as vrijednost,
    round((avg(r.zvuk) + avg(r.izrada) + avg(r.vrijednost)) / 3, 2) as prosjek
  from public.oprema o left join public.recenzije r on r.oprema = o.id
  group by o.id;

-- ---------------------------------------------------------------------------
-- Pravila pristupa (Row Level Security)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['oglasi','poslovi','teme','odgovori','oprema','recenzije'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "svi čitaju" on public.%I for select using (true)', t);
    execute format('create policy "prijavljeni objavljuju svoje" on public.%I for insert to authenticated with check (autor = (select auth.uid()))', t);
    execute format('create policy "autor mijenja svoje" on public.%I for update to authenticated using (autor = (select auth.uid())) with check (autor = (select auth.uid()))', t);
    execute format('create policy "autor ili admin briše" on public.%I for delete to authenticated using (autor = (select auth.uid()) or public.je_admin())', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Neprijavljeni čitaju sve osim kontakta.
grant select (id, autor, naslov, kategorija, stanje, cijena, valuta, grad, drzava, opis, slike, created_at) on public.oglasi to anon;
grant select (id, autor, naslov, vrsta, honorar, grad, drzava, rok, opis, created_at) on public.poslovi to anon;
grant select on public.teme, public.odgovori, public.oprema, public.recenzije to anon;
grant select on public.teme_pregled, public.oprema_pregled to anon, authenticated;

-- Prijavljeni smiju upisati i mijenjati samo ova polja (autor i datum postavlja baza).
grant insert (id, naslov, kategorija, stanje, cijena, valuta, grad, drzava, opis, kontakt, slike) on public.oglasi to authenticated;
grant update (naslov, kategorija, stanje, cijena, valuta, grad, drzava, opis, kontakt, slike) on public.oglasi to authenticated;
grant insert (naslov, vrsta, honorar, grad, drzava, rok, opis, kontakt) on public.poslovi to authenticated;
grant update (naslov, vrsta, honorar, grad, drzava, rok, opis, kontakt) on public.poslovi to authenticated;
grant insert (naslov, kategorija, tekst) on public.teme to authenticated;
grant insert (tema, tekst) on public.odgovori to authenticated;
grant insert (naziv, kategorija) on public.oprema to authenticated;
grant insert (oprema, zvuk, izrada, vrijednost, tekst) on public.recenzije to authenticated;
grant update (zvuk, izrada, vrijednost, tekst) on public.recenzije to authenticated;

-- ---------------------------------------------------------------------------
-- Fotografije oglasa (javno spremište, svaki korisnik piše samo u svoju mapu)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('slike', 'slike', true, 2097152, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do nothing;

create policy "slike: upload u svoju mapu" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'slike' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "slike: vlasnik ili admin vidi" on storage.objects
  for select to authenticated
  using (bucket_id = 'slike' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.je_admin()));

create policy "slike: vlasnik ili admin briše" on storage.objects
  for delete to authenticated
  using (bucket_id = 'slike' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.je_admin()));
