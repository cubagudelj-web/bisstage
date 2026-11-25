-- BisStage:
--  1. Kategorija "Gitare" razdvojena na "Akustične gitare" i "Električne gitare".
--  2. Nova kategorija "Bas pojačala".
--     Vrijedi za Oglasnik, Ocjene opreme i spremljene pretrage (iste kategorije svugdje).
--     Postojeći oglasi i oprema razvrstavaju se automatski po naslovu / nazivu modela.
--  3. Fotografije u odgovorima na forumu (najviše 4 po odgovoru).
-- Ova datoteka uključuje sve iz 23 i 25, pa ih ne moraš posebno pokretati.
-- Pokreni u Supabaseu: SQL Editor -> New query -> zalijepi -> Run. Smije se pokrenuti i više puta.

alter table public.oglasi drop constraint if exists oglasi_kategorija_check;
alter table public.oprema drop constraint if exists oprema_kategorija_check;
alter table public.pretrage drop constraint if exists pretrage_kategorija_check;

-- Prepoznavanje kategorije po nazivu (bez obzira na velika/mala slova).
create or replace function public.kategorija_po_nazivu(kat text, naziv text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  bas   constant text := '(bass|\mbas\M|stingray|thunderbird|trbx|\mBB\s?\d{3}|\mSR\s?\d{3})';
  akus  constant text := '(akusti|acoustic|klasi[cč]n|classical|nylon|najlon|dreadnought|jumbo|parlor|\mD-?\d{2,3}(CE)?\M|\mC40\M|\mCG\s?\d|\mCE\M|martin|taylor|cordoba|furch|alhambra|admira|ortega|\mLAG\M)';
  amp   constant text := '(poja[cč]al|\mamp\M|amplifier|combo|katana|spark|\mMG\s?\d|\mHB-10|\mhead\M|blues junior|hot rod|deluxe reverb|twin reverb|\mAC\s?\d{1,2}\M|\mDSL\s?\d|\mJCM|mustang|champion|\mcube\M|rumble|frontman|blackstar|orange|laney|bugera|peavey|mesa|engl|ampeg|tone master|nextone|\mTHR\s?\d|markbass|hartke|gallien|\mGK\M|aguilar|trace elliot|\mBA-?\d)';
  basamp constant text := '(bass|\mbas\M|ampeg|rumble|markbass|hartke|gallien|\mGK\M|aguilar|trace elliot|darkglass|eden|\mBA-?\d)';
begin
  if kat = 'Gitare i basovi' then
    return case when naziv ~* bas then 'Bas gitare' when naziv ~* akus then 'Akustične gitare' else 'Električne gitare' end;
  elsif kat = 'Gitare' then
    return case when naziv ~* akus then 'Akustične gitare' else 'Električne gitare' end;
  elsif kat = 'Gitarske pedale i pojačala' then
    return case when naziv ~* amp then (case when naziv ~* basamp then 'Bas pojačala' else 'Gitarska pojačala' end) else 'Gitarske pedale' end;
  elsif kat = 'Gitarska pojačala' and naziv ~* basamp then
    return 'Bas pojačala';
  elsif kat in ('Klavijature', 'Puhački')
    and naziv ~* '(harmonik|akordeon|accordion|scandalli|weltmeister|paolo soprani|pigini|bugari|\mFR-?\d+X?\M)' then
    return 'Harmonike';
  elsif kat in ('Ozvučenje', 'Studijska oprema')
    and naziv ~* '(mikrofon|microphone|\mmic\M|\mSM\s?5[78]|\mSM\s?7B?\M|beta\s?5[78]|beta\s?91|\mNT-?1|\mNT-?USB|\mAT\s?20[23]0|\mC\s?214\M|\mC\s?414\M|\me\s?9\d{2}\M|\mMD\s?421|\mU\s?87|\mTLM\s?\d|podmic|procaster)' then
    return 'Mikrofoni';
  end if;
  return kat;
end $$;

update public.oglasi set kategorija = public.kategorija_po_nazivu(kategorija, naslov)
  where kategorija is distinct from public.kategorija_po_nazivu(kategorija, naslov);
update public.oprema set kategorija = public.kategorija_po_nazivu(kategorija, naziv)
  where kategorija is distinct from public.kategorija_po_nazivu(kategorija, naziv);
update public.pretrage set kategorija = case kategorija
    when 'Gitarske pedale i pojačala' then 'Gitarske pedale' else 'Električne gitare' end
  where kategorija in ('Gitare i basovi', 'Gitare', 'Gitarske pedale i pojačala');

alter table public.oglasi add constraint oglasi_kategorija_check check (kategorija in
  ('Akustične gitare','Električne gitare','Bas gitare','Gitarske pedale','Gitarska pojačala','Bas pojačala','Bubnjevi i udaraljke','Klavijature','Harmonike','Gudački','Puhački','Tamburice','Mikrofoni','Ozvučenje','Studijska oprema'));
alter table public.oprema add constraint oprema_kategorija_check check (kategorija in
  ('Akustične gitare','Električne gitare','Bas gitare','Gitarske pedale','Gitarska pojačala','Bas pojačala','Bubnjevi i udaraljke','Klavijature','Harmonike','Gudački','Puhački','Tamburice','Mikrofoni','Ozvučenje','Studijska oprema'));
alter table public.pretrage add constraint pretrage_kategorija_check check (kategorija is null or kategorija in
  ('Akustične gitare','Električne gitare','Bas gitare','Gitarske pedale','Gitarska pojačala','Bas pojačala','Bubnjevi i udaraljke','Klavijature','Harmonike','Gudački','Puhački','Tamburice','Mikrofoni','Ozvučenje','Studijska oprema'));

-- Autor i administrator smiju promijeniti kategoriju opreme (isto kao u 23 i 25).
grant update (kategorija) on public.oprema to authenticated;
drop policy if exists "admin mijenja opremu" on public.oprema;
create policy "admin mijenja opremu" on public.oprema for update to authenticated
  using (public.je_admin()) with check (public.je_admin());

-- Fotografije u odgovorima na forumu: najviše 4, samo iz autorove mape u spremištu.
alter table public.odgovori add column if not exists slike text[] not null default '{}';
alter table public.odgovori drop constraint if exists odgovori_slike_check;
create or replace function public.slike_autora(p_autor uuid, p_slike text[]) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(bool_and(split_part(s, '/', 1) = p_autor::text), true) from unnest(p_slike) s
$$;
alter table public.odgovori add constraint odgovori_slike_check check (
  cardinality(slike) <= 4 and public.slike_autora(autor, slike));
grant insert (id, tema, tekst, slike) on public.odgovori to authenticated;

-- Pregled: koliko čega ima po kategorijama.
select 'oglasi' as gdje, kategorija, count(*) as broj from public.oglasi group by kategorija
union all
select 'oprema', kategorija, count(*) from public.oprema group by kategorija
order by 1, 2;
