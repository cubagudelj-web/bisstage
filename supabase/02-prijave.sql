-- BisStage: prijave neprimjerenih objava
-- Pokreni jednom u Supabaseu: SQL Editor -> New query -> zalijepi -> Run.
-- Prijavljeni korisnici mogu prijaviti objavu; prijave vidi i rješava samo administrator.

create table public.prijave (
  id uuid primary key default gen_random_uuid(),
  autor uuid not null default auth.uid() references public.profili (id) on delete cascade,
  vrsta text not null check (vrsta in ('oglas','posao','tema','odgovor','oprema','recenzija')),
  objekt uuid not null,
  poveznica text not null check (poveznica ~ '^#[a-z]+-[0-9a-f-]{36}$'),
  naslov text not null check (char_length(naslov) between 1 and 200),
  razlog text not null check (razlog in ('Spam ili reklama','Prijevara ili lažna objava','Uvredljiv sadržaj','Nezakonit sadržaj','Ne pripada ovdje','Drugo')),
  napomena text check (char_length(napomena) <= 500),
  rijeseno boolean not null default false,
  created_at timestamptz not null default now(),
  unique (autor, vrsta, objekt)
);
create index on public.prijave (rijeseno, created_at desc);

alter table public.prijave enable row level security;

create policy "prijave: prijavljeni prijavljuju" on public.prijave
  for insert to authenticated with check (autor = (select auth.uid()));
create policy "prijave: admin čita" on public.prijave
  for select to authenticated using (public.je_admin());
create policy "prijave: admin rješava" on public.prijave
  for update to authenticated using (public.je_admin()) with check (public.je_admin());
create policy "prijave: admin briše" on public.prijave
  for delete to authenticated using (public.je_admin());

revoke all on public.prijave from anon, authenticated;
grant insert (vrsta, objekt, poveznica, naslov, razlog, napomena) on public.prijave to authenticated;
grant select, delete on public.prijave to authenticated;
grant update (rijeseno) on public.prijave to authenticated;
