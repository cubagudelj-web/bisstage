-- BisStage: rubrika Događaji (koncerti, festivali, tečajevi...)
-- Pokreni jednom u Supabaseu: SQL Editor -> New query -> zalijepi -> Run.

create table public.dogadaji (
  id uuid primary key default gen_random_uuid(),
  autor uuid not null default auth.uid() references public.profili (id) on delete cascade,
  naziv text not null check (char_length(naziv) between 3 and 120),
  vrsta text not null check (vrsta in ('Koncert','Festival','Tečaj ili radionica','Jam session','Audicija ili natjecanje','Sajam opreme','Ostalo')),
  pocetak timestamptz not null,
  kraj timestamptz check (kraj is null or kraj >= pocetak),
  mjesto text not null check (char_length(mjesto) between 1 and 120),
  grad text not null check (char_length(grad) between 1 and 60),
  drzava text not null check (drzava in ('Hrvatska','Slovenija','Bosna i Hercegovina','Srbija','Crna Gora','Sjeverna Makedonija')),
  ulaz text check (char_length(ulaz) <= 60),
  poveznica text check (poveznica is null or (poveznica ~ '^https?://[^\s<>"]+$' and char_length(poveznica) <= 300)),
  opis text not null check (char_length(opis) between 1 and 3000),
  plakat text check (plakat is null or (plakat ~ '^[0-9a-f-]{36}/dogadaji/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$' and split_part(plakat, '/', 1) = autor::text)),
  istaknut_od timestamptz,
  istaknut_do timestamptz,
  created_at timestamptz not null default now()
);
create index on public.dogadaji (pocetak);
create index on public.dogadaji (autor);

alter table public.dogadaji enable row level security;
create policy "svi čitaju" on public.dogadaji for select using (true);
create policy "prijavljeni objavljuju svoje" on public.dogadaji for insert to authenticated with check (autor = (select auth.uid()));
create policy "autor mijenja svoje" on public.dogadaji for update to authenticated using (autor = (select auth.uid())) with check (autor = (select auth.uid()));
create policy "autor ili admin briše" on public.dogadaji for delete to authenticated using (autor = (select auth.uid()) or public.je_admin());

revoke all on public.dogadaji from anon, authenticated;
grant select on public.dogadaji to anon, authenticated;
grant delete on public.dogadaji to authenticated;
grant insert (id, naziv, vrsta, pocetak, kraj, mjesto, grad, drzava, ulaz, poveznica, opis, plakat) on public.dogadaji to authenticated;
grant update (naziv, vrsta, pocetak, kraj, mjesto, grad, drzava, ulaz, poveznica, opis, plakat) on public.dogadaji to authenticated;

-- Događaji se mogu i prijaviti kao neprimjereni.
alter table public.prijave drop constraint prijave_vrsta_check;
alter table public.prijave add constraint prijave_vrsta_check
  check (vrsta in ('oglas','posao','tema','odgovor','oprema','recenzija','dogadaj'));
