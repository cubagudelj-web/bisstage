-- BisStage: autor opreme i administrator smiju promijeniti naziv opreme u Ocjenama opreme.
-- Pokreni u Supabaseu: SQL Editor -> New query -> zalijepi -> Run. Smije se pokrenuti i više puta.

grant update (naziv, kategorija) on public.oprema to authenticated;

-- Administrator smije mijenjati svu opremu (isto kao u 23, 25 i 26).
drop policy if exists "admin mijenja opremu" on public.oprema;
create policy "admin mijenja opremu" on public.oprema for update to authenticated
  using (public.je_admin()) with check (public.je_admin());
