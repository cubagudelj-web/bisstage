-- BisStage: iste kategorije u Oglasniku i Ocjenama opreme, nove kategorije "Harmonike" i "Mikrofoni".
-- Kategorije: Gitare, Bas gitare, Gitarske pedale, Gitarska pojačala, Bubnjevi i udaraljke, Klavijature,
--             Harmonike, Gudački, Puhački, Tamburice, Mikrofoni, Ozvučenje, Studijska oprema.
-- Postojeći oglasi, oprema i spremljene pretrage automatski se razvrstavaju po naslovu / nazivu modela.
-- Ova datoteka uključuje i sve iz 23-oprema-gitare-bas.sql, pa 23 ne moraš posebno pokretati.
-- Pokreni u Supabaseu: SQL Editor -> New query -> zalijepi -> Run. Smije se pokrenuti i više puta.

alter table public.oglasi drop constraint if exists oglasi_kategorija_check;
alter table public.oprema drop constraint if exists oprema_kategorija_check;
alter table public.pretrage drop constraint if exists pretrage_kategorija_check;

-- Prepoznavanje po nazivu (bez obzira na velika/mala slova).
create or replace function public.kategorija_po_nazivu(kat text, naziv text) returns text
language sql immutable set search_path = '' as $$
  select case
    when kat = 'Gitare i basovi' then
      case when naziv ~* '(bass|\mbas\M|stingray|thunderbird|trbx|\mBB\s?\d{3}|\mSR\s?\d{3})' then 'Bas gitare' else 'Gitare' end
    when kat = 'Gitarske pedale i pojačala' then
      case when naziv ~* '(poja[cč]al|\mamp\M|amplifier|combo|katana|spark|\mMG\s?\d|\mHB-10|\mhead\M|blues junior|hot rod|deluxe reverb|twin reverb|\mAC\s?\d{1,2}\M|\mDSL\s?\d|\mJCM|mustang|champion|\mcube\M|rumble|frontman|blackstar|orange|laney|bugera|peavey|mesa|engl|ampeg|tone master|nextone|\mTHR\s?\d)'
        then 'Gitarska pojačala' else 'Gitarske pedale' end
    when kat in ('Klavijature', 'Puhački')
      and naziv ~* '(harmonik|akordeon|accordion|scandalli|weltmeister|paolo soprani|pigini|bugari|\mFR-?\d+X?\M)' then 'Harmonike'
    when kat in ('Ozvučenje', 'Studijska oprema')
      and naziv ~* '(mikrofon|microphone|\mmic\M|\mSM\s?5[78]|\mSM\s?7B?\M|beta\s?5[78]|beta\s?91|\mNT-?1|\mNT-?USB|\mAT\s?20[23]0|\mC\s?214\M|\mC\s?414\M|\me\s?9\d{2}\M|\mMD\s?421|\mU\s?87|\mTLM\s?\d|podmic|procaster)' then 'Mikrofoni'
    else kat end
$$;

update public.oglasi set kategorija = public.kategorija_po_nazivu(kategorija, naslov)
  where kategorija is distinct from public.kategorija_po_nazivu(kategorija, naslov);
update public.oprema set kategorija = public.kategorija_po_nazivu(kategorija, naziv)
  where kategorija is distinct from public.kategorija_po_nazivu(kategorija, naziv);
update public.pretrage set kategorija = case kategorija
    when 'Gitare i basovi' then 'Gitare' when 'Gitarske pedale i pojačala' then 'Gitarske pedale' end
  where kategorija in ('Gitare i basovi', 'Gitarske pedale i pojačala');

alter table public.oglasi add constraint oglasi_kategorija_check check (kategorija in
  ('Gitare','Bas gitare','Gitarske pedale','Gitarska pojačala','Bubnjevi i udaraljke','Klavijature','Harmonike','Gudački','Puhački','Tamburice','Mikrofoni','Ozvučenje','Studijska oprema'));
alter table public.oprema add constraint oprema_kategorija_check check (kategorija in
  ('Gitare','Bas gitare','Gitarske pedale','Gitarska pojačala','Bubnjevi i udaraljke','Klavijature','Harmonike','Gudački','Puhački','Tamburice','Mikrofoni','Ozvučenje','Studijska oprema'));
alter table public.pretrage add constraint pretrage_kategorija_check check (kategorija is null or kategorija in
  ('Gitare','Bas gitare','Gitarske pedale','Gitarska pojačala','Bubnjevi i udaraljke','Klavijature','Harmonike','Gudački','Puhački','Tamburice','Mikrofoni','Ozvučenje','Studijska oprema'));

-- Autor i administrator smiju promijeniti kategoriju opreme (isto kao u 23).
grant update (kategorija) on public.oprema to authenticated;
drop policy if exists "admin mijenja opremu" on public.oprema;
create policy "admin mijenja opremu" on public.oprema for update to authenticated
  using (public.je_admin()) with check (public.je_admin());

-- Pregled: koliko čega ima po kategorijama.
select 'oglasi' as gdje, kategorija, count(*) as broj from public.oglasi group by kategorija
union all
select 'oprema', kategorija, count(*) from public.oprema group by kategorija
order by 1, 2;
