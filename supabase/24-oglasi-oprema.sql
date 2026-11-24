-- BisStage: povezivanje oglasa s ocjenama opreme.
-- Oglas može biti povezan s jednim modelom iz Ocjena opreme (stupac oglasi.oprema).
-- U oglasu se tada prikazuje prosječna ocjena modela, a na stranici modela oglasi za taj model.
-- Postojeći oglasi povezuju se automatski kad su sve riječi naziva modela u naslovu oglasa.
-- Pokreni u Supabaseu: SQL Editor -> New query -> zalijepi -> Run. Smije se pokrenuti i više puta.

alter table public.oglasi add column if not exists oprema uuid references public.oprema (id) on delete set null;
create index if not exists oglasi_oprema_idx on public.oglasi (oprema) where oprema is not null;

grant select (oprema) on public.oglasi to anon;
grant insert (oprema), update (oprema) on public.oglasi to authenticated;

-- Riječi teksta: mala slova, sve osim slova i brojeva postaje razmak.
create or replace function public.rijeci(t text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_remove(regexp_split_to_array(trim(regexp_replace(lower(coalesce(t, '')), '[^[:alnum:]čćšđž]+', ' ', 'g')), ' '), ''), '{}')
$$;

-- Automatsko povezivanje postojećih oglasa (najdulji naziv modela koji se cijeli nalazi u naslovu).
update public.oglasi og set oprema = (
    select o.id from public.oprema o
    where cardinality(public.rijeci(o.naziv)) >= 2
      and public.rijeci(o.naziv) <@ public.rijeci(og.naslov)
    order by cardinality(public.rijeci(o.naziv)) desc, length(o.naziv) desc
    limit 1)
  where og.oprema is null;

-- Pregled povezanih oglasa.
select og.naslov as oglas, o.naziv as model
  from public.oglasi og join public.oprema o on o.id = og.oprema
  order by og.created_at desc;
