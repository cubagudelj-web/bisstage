-- BisStage: forum, izmjene podkategorija.
-- "Traženje članova" -> "Suradnja u bendu", "Klubovi i nastupi" -> "Koncerti i live svirka",
-- nova "Gradnja studija i akustika" u Studiju i snimanju. Postojeće teme se premještaju same.
-- Pokreni u Supabaseu: SQL Editor -> New query -> zalijepi -> Run. Smije se pokrenuti i više puta.

alter table public.teme drop constraint if exists teme_podkategorija_check;
update public.teme set podkategorija = 'Suradnja u bendu' where podkategorija = 'Traženje članova';
update public.teme set podkategorija = 'Koncerti i live svirka' where podkategorija = 'Klubovi i nastupi';
alter table public.teme add constraint teme_podkategorija_check check (podkategorija is null or podkategorija = any (case kategorija
  when 'Instrumenti' then array['Gitare i basovi','Pedale, pojačala i efekti','Bubnjevi i udaraljke','Klavijature','Tamburice','Gudački i puhački','Servis i održavanje']
  when 'Bendovi i svirke' then array['Suradnja u bendu','Svadbe i privatne svirke','Koncerti i live svirka','Honorari i ugovori','Ozvučenje i rasvjeta']
  when 'Studio i snimanje' then array['Kućni studio','Gradnja studija i akustika','Mikrofoni i snimanje','Miks i mastering','Programi i dodaci (DAW, plugini)','Objava glazbe i autorska prava']
  when 'Učenje i poduka' then array['Početnici','Glazbena škola i akademija','Teorija i harmonija','Tehnika i vježbanje','Pjevanje']
  when 'Razgovor' then array['Koncerti i festivali','Nova glazba','Glazbena scena regije','Opušteno']
  else array[]::text[] end));
