-- BisStage: uvoz iz kalendara prepoznaje grad i državu iz adrese događaja
-- (npr. "Lisinski, Trg Stjepana Radića 4, Zagreb, Croatia" -> Zagreb, Hrvatska).
-- Grad upisan uz kalendar koristi se samo kad ga adresa ne otkriva. Događaji izvan regije se preskaču.
-- Pokreni u Supabaseu: SQL Editor -> New query -> zalijepi -> Run. Smije se pokrenuti i više puta.

create or replace function public.ics_mjesto(p_lok text, out grad text, out drzava text, out strana boolean)
language plpgsql immutable set search_path = '' as $$
declare
  v_dijelovi text[]; v_d text; i int; v_n int; v_idx int; v_kand text;
begin
  strana := false;
  if coalesce(trim(p_lok), '') = '' then return; end if;
  -- zagrade, npr. "(Local Name: Hrvatska)", i višak razmaka
  p_lok := regexp_replace(p_lok, '\([^)]*\)', '', 'g');
  v_dijelovi := array(select trim(regexp_replace(t, '\s+', ' ', 'g')) from unnest(string_to_array(p_lok, ',')) t where trim(t) <> '');
  v_n := cardinality(v_dijelovi);
  if v_n = 0 then return; end if;

  for i in reverse v_n..1 loop
    v_d := lower(v_dijelovi[i]);
    drzava := case
      when v_d in ('hrvatska', 'croatia', 'republika hrvatska', 'hr') then 'Hrvatska'
      when v_d in ('slovenija', 'slovenia', 'si') then 'Slovenija'
      when v_d in ('bosna i hercegovina', 'bosnia and herzegovina', 'bosnia & herzegovina', 'bih', 'ba') then 'Bosna i Hercegovina'
      when v_d in ('srbija', 'serbia', 'србија', 'rs') then 'Srbija'
      when v_d in ('crna gora', 'montenegro', 'црна гора', 'me') then 'Crna Gora'
      when v_d in ('sjeverna makedonija', 'north macedonia', 'makedonija', 'macedonia', 'северна македонија', 'mk') then 'Sjeverna Makedonija'
      when v_d in ('austria', 'austrija', 'österreich', 'germany', 'njemačka', 'deutschland', 'italy', 'italija', 'italia',
                   'hungary', 'mađarska', 'magyarország', 'switzerland', 'švicarska', 'france', 'francuska', 'united kingdom', 'uk',
                   'usa', 'united states', 'sad', 'netherlands', 'nizozemska', 'czech republic', 'czechia', 'češka', 'slovakia',
                   'slovačka', 'poland', 'poljska', 'spain', 'španjolska', 'sweden', 'švedska', 'ireland', 'irska', 'bulgaria',
                   'bugarska', 'romania', 'rumunjska', 'greece', 'grčka', 'albania', 'albanija', 'kosovo', 'belgium', 'belgija')
        then '-'
      else null end;
    if drzava is not null then v_idx := i; exit; end if;
  end loop;

  if drzava = '-' then drzava := null; strana := true; return; end if;

  -- grad je dio ispred države; bez države zadnji dio, ali samo ako ima poštanski broj (npr. "10000 Zagreb")
  if v_idx is not null then
    if v_idx > 1 then v_kand := v_dijelovi[v_idx - 1]; end if;
  elsif v_n > 1 and v_dijelovi[v_n] ~ '\d{4,5}' then
    v_kand := v_dijelovi[v_n];
  end if;
  if v_kand is null then return; end if;
  -- poštanski broj ispred ili iza ("10000 Zagreb", "HR-21000 Split", "Zagreb 10000")
  v_kand := trim(regexp_replace(v_kand, '^([A-Za-z]{2}-)?\d{4,5}\s*|\s*\d{4,5}$', '', 'g'));
  -- samo poštanski broj: uzmi dio ispred njega
  if v_kand = '' and v_idx is not null and v_idx > 2 then
    v_kand := trim(regexp_replace(v_dijelovi[v_idx - 2], '^([A-Za-z]{2}-)?\d{4,5}\s*|\s*\d{4,5}$', '', 'g'));
  end if;
  -- ulica s kućnim brojem ili naziv dvorane nisu grad
  if v_kand ~ '\d' or v_kand !~ '[[:alpha:]]' or char_length(v_kand) > 40 then return; end if;
  -- prvi dio adrese obično je naziv mjesta održavanja; grad je samo ako ne zvuči kao dvorana ili klub
  if v_kand = v_dijelovi[1] and (v_n > 2 or v_kand ~* '(klub|club|dom|dvoran|hall|crkv|church|kazali|teat|arena|bar|pub|caff|cafe|kafi|centar|center|galerij|trg|ulica|park|hotel|škol|skol|muzej|museum|festival|k\.d\.|lisinsk|pozori|kino|stage|studio)'
                                 or array_length(regexp_split_to_array(v_kand, '\s+'), 1) > 3) then return; end if;
  grad := v_kand;
end $$;

create or replace function public.kalendar_spremi(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.kalendari; r record; x record; v_broj int := 0; v_preskoceno int := 0; v_kljucevi text[] := '{}';
  v_naziv text; v_opis text; v_link text; v_vrsta text; v_kraj timestamptz;
  m record;
begin
  select * into c from public.kalendari where id = p_id;
  if c.id is null then return jsonb_build_object('stanje', 'nema'); end if;
  if c.zahtjev is null then
    return jsonb_build_object('stanje', case when c.greska is null then 'gotovo' else 'greska' end, 'broj', c.zadnji_broj, 'greska', c.greska);
  end if;
  select status_code, content, timed_out, error_msg into r from net._http_response where id = c.zahtjev;
  if not found then
    if c.zahtjev_vrijeme < now() - interval '30 minutes' then
      update public.kalendari set zahtjev = null, greska = 'Kalendar se nije javio. Pokušaj ponovo kasnije.' where id = c.id;
      return jsonb_build_object('stanje', 'greska', 'greska', 'Kalendar se nije javio. Pokušaj ponovo kasnije.');
    end if;
    return jsonb_build_object('stanje', 'ceka');
  end if;

  if coalesce(r.timed_out, false) or r.error_msg is not null or r.status_code is null then
    update public.kalendari set zahtjev = null, greska = 'Adresa nije dostupna' || coalesce(' (' || left(r.error_msg, 120) || ')', '') || '.' where id = c.id;
  elsif r.status_code between 300 and 399 then
    update public.kalendari set zahtjev = null, greska = 'Adresa preusmjerava na drugu (HTTP ' || r.status_code || '). Upiši konačnu adresu kalendara.' where id = c.id;
  elsif r.status_code not between 200 and 299 then
    update public.kalendari set zahtjev = null, greska = 'Kalendar nije dostupan (HTTP ' || r.status_code || '). Je li kalendar javan?' where id = c.id;
  elsif position('BEGIN:VCALENDAR' in coalesce(r.content, '')) = 0 then
    update public.kalendari set zahtjev = null, greska = 'Na ovoj adresi nije kalendar u iCal (.ics) obliku.' where id = c.id;
  else
    for x in select * from public.ics_dogadaji(r.content) d
             where coalesce(d.kraj, d.pocetak) >= now() - interval '12 hours' and d.pocetak < now() + interval '365 days'
             order by d.pocetak limit 200 loop
      v_naziv := left(regexp_replace(trim(coalesce(x.naziv, '')), '\s+', ' ', 'g'), 120);
      if char_length(v_naziv) < 3 then v_preskoceno := v_preskoceno + 1; continue; end if;
      v_opis := regexp_replace(coalesce(x.opis, ''), '<br\s*/?>|</p>', chr(10), 'gi');
      v_opis := regexp_replace(v_opis, '<[^>]*>', '', 'g');
      v_opis := replace(replace(replace(replace(replace(v_opis, '&nbsp;', ' '), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&amp;', '&');
      v_opis := left(nullif(trim(v_opis), ''), 3000);
      v_link := case when x.poveznica ~ '^https?://[^\s<>"]+$' and char_length(x.poveznica) <= 300 then x.poveznica else c.poveznica end;
      v_vrsta := case
        when v_naziv ~* 'festival' then 'Festival'
        when v_naziv ~* 'jam' then 'Jam session'
        when v_naziv ~* 'radionic|tečaj|tecaj|masterclass|workshop|seminar' then 'Tečaj ili radionica'
        when v_naziv ~* 'audicij|natjecanj' then 'Audicija ili natjecanje'
        when v_naziv ~* 'sajam' then 'Sajam opreme'
        else c.vrsta end;
      v_kraj := case when x.cijeli_dan and x.kraj is not null then x.kraj - interval '1 second' else x.kraj end;
      select * into m from public.ics_mjesto(x.lokacija);
      if m.strana then v_preskoceno := v_preskoceno + 1; continue; end if;
      begin
        insert into public.dogadaji (autor, naziv, vrsta, pocetak, kraj, mjesto, grad, drzava, poveznica, opis,
                                     kalendar, izvor_uid, izvor, cijeli_dan)
        values (c.autor, v_naziv, v_vrsta, x.pocetak, v_kraj,
                coalesce(nullif(left(trim(split_part(x.lokacija, ',', 1)), 120), ''), c.mjesto), coalesce(m.grad, c.grad), coalesce(m.drzava, c.drzava), v_link,
                coalesce(v_opis, v_naziv || ' (' || c.naziv || ')'), c.id, left(x.kljuc, 500), c.naziv, x.cijeli_dan)
        on conflict (kalendar, izvor_uid) do update set naziv = excluded.naziv, vrsta = excluded.vrsta, pocetak = excluded.pocetak,
          kraj = excluded.kraj, mjesto = excluded.mjesto, grad = excluded.grad, drzava = excluded.drzava, poveznica = excluded.poveznica,
          opis = excluded.opis, izvor = excluded.izvor, cijeli_dan = excluded.cijeli_dan;
        v_kljucevi := v_kljucevi || left(x.kljuc, 500);
        v_broj := v_broj + 1;
      exception when others then
        v_preskoceno := v_preskoceno + 1;
      end;
    end loop;
    -- Nadolazeći događaji kojih više nema u kalendaru (otkazani ili obrisani) uklanjaju se.
    delete from public.dogadaji where kalendar = c.id and pocetak > now() and not (izvor_uid = any (v_kljucevi));
    update public.kalendari set zahtjev = null, greska = null, zadnji_uvoz = now(), zadnji_broj = v_broj where id = c.id;
    return jsonb_build_object('stanje', 'gotovo', 'broj', v_broj, 'preskoceno', v_preskoceno);
  end if;
  select greska into c.greska from public.kalendari where id = c.id;
  return jsonb_build_object('stanje', 'greska', 'greska', c.greska);
end $$;
revoke all on function public.kalendar_spremi(uuid) from public, anon, authenticated;
