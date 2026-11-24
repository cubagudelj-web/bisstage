-- BisStage: u ocjenama opreme razdvojene kategorije
--   "Gitare i basovi"            -> "Gitare" i "Bas gitare"
--   "Gitarske pedale i pojačala" -> "Gitarske pedale" i "Gitarska pojačala"
-- Postojeća oprema razvrstava se automatski po nazivu modela (krivo razvrstano možeš
-- poslije ručno promijeniti na stranici opreme, gumb "Promijeni kategoriju").
-- Oglasnik se ne mijenja.
-- Pokreni u Supabaseu: SQL Editor -> New query -> zalijepi -> Run. Smije se pokrenuti i više puta.

alter table public.oprema drop constraint if exists oprema_kategorija_check;

update public.oprema set kategorija = case
    when naziv ~* '(bass|\mbas\M|stingray|thunderbird|trbx|\mBB\s?\d{3}|\mSR\s?\d{3})' then 'Bas gitare'
    else 'Gitare' end
  where kategorija = 'Gitare i basovi';

update public.oprema set kategorija = case
    when naziv ~* '(poja[cč]al|\mamp\M|amplifier|combo|katana|spark|\mMG\s?\d|\mHB-10|\mhead\M|blues junior|hot rod|deluxe reverb|twin reverb|\mAC\s?\d{1,2}\M|\mDSL\s?\d|\mJCM|mustang|champion|\mcube\M|rumble|frontman|blackstar|orange|laney|bugera|peavey|mesa|engl|ampeg|tone master|nextone|\mTHR\s?\d)'
      then 'Gitarska pojačala'
    else 'Gitarske pedale' end
  where kategorija = 'Gitarske pedale i pojačala';

alter table public.oprema add constraint oprema_kategorija_check check (kategorija in
  ('Gitare','Bas gitare','Gitarske pedale','Gitarska pojačala','Bubnjevi i udaraljke','Klavijature','Gudački','Puhački','Tamburice','Ozvučenje','Studijska oprema'));

-- Autor i administrator smiju promijeniti kategoriju opreme.
grant update (kategorija) on public.oprema to authenticated;
drop policy if exists "admin mijenja opremu" on public.oprema;
create policy "admin mijenja opremu" on public.oprema for update to authenticated
  using (public.je_admin()) with check (public.je_admin());

-- Pregled nakon razvrstavanja.
select kategorija, count(*) as broj, string_agg(naziv, ', ' order by naziv) as modeli
  from public.oprema
  where kategorija in ('Gitare','Bas gitare','Gitarske pedale','Gitarska pojačala')
  group by kategorija order by kategorija;
