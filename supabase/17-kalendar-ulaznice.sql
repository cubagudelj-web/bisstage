-- BisStage: uvoz iz kalendara uzima prvu poveznicu iz opisa događaja (npr. na ulaznice)
-- kad kalendar nema posebno polje za poveznicu (Google kalendar ga nema).
-- Sadrži i ispravak čitanja kalendara (greška "DELETE requires a WHERE clause") te prepoznavanje grada iz adrese (kao 16-kalendar-grad.sql), pa radi i bez nje.
-- Pokreni u Supabaseu: SQL Editor -> New query -> zalijepi -> Run. Smije se pokrenuti i više puta.

-- Vraća sve događaje iz kalendara; ponavljajući događaji razvijaju se za sljedećih 60 dana.
create or replace function public.ics_dogadaji(p_ics text)
returns table (kljuc text, naziv text, pocetak timestamptz, kraj timestamptz, cijeli_dan boolean,
               lokacija text, opis text, poveznica text)
language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare
  v_lines text[]; v_line text; m text[]; v_name text; v_params text; v_val text; v_tzid text;
  in_ev boolean := false; in_sub int := 0;
  e jsonb; v_ex timestamptz[];
  t record; v_start timestamptz; v_end timestamptz; v_all boolean; v_dur interval;
  v_rule text; v_freq text; v_int int; v_count int; v_until timestamptz; v_days text[];
  v_local timestamp; v_occ timestamp; v_occ_ts timestamptz; n int; k int; v_made int; v_tz text := 'Europe/Zagreb';
  v_dow int; d text; v_week timestamp;
begin
  create temp table if not exists ics_tmp (kljuc text primary key, naziv text, pocetak timestamptz, kraj timestamptz,
    cijeli_dan boolean, lokacija text, opis text, poveznica text, otkazan boolean) on commit drop;
  delete from ics_tmp where true; -- "where true": Supabase ne dopušta DELETE bez WHERE
  create temp table if not exists ics_ev (rb serial, d jsonb) on commit drop;
  delete from ics_ev where true;

  p_ics := replace(replace(left(coalesce(p_ics, ''), 3000000), chr(13) || chr(10), chr(10)), chr(13), chr(10));
  p_ics := regexp_replace(p_ics, '\n[ \t]', '', 'g');
  v_lines := string_to_array(p_ics, chr(10));

  foreach v_line in array v_lines loop
    if v_line = '' then continue; end if;
    m := regexp_match(v_line, '^([A-Za-z0-9-]+)((?:;[^:;=]+=(?:"[^"]*"|[^:;"]*)(?:,(?:"[^"]*"|[^:;",]*))*)*):(.*)$');
    if m is null then continue; end if;
    v_name := upper(m[1]); v_params := m[2]; v_val := m[3];
    if v_name = 'BEGIN' and upper(v_val) = 'VEVENT' then in_ev := true; in_sub := 0; e := '{}'; v_ex := '{}'; continue; end if;
    if not in_ev then continue; end if;
    if v_name = 'BEGIN' then in_sub := in_sub + 1; continue; end if;
    if v_name = 'END' and in_sub > 0 then in_sub := in_sub - 1; continue; end if;
    if v_name = 'END' and upper(v_val) = 'VEVENT' then
      in_ev := false;
      insert into ics_ev (d) values (e || jsonb_build_object('exdate', to_jsonb(v_ex)));
      continue;
    end if;
    if in_sub > 0 then continue; end if;
    v_tzid := (regexp_match(v_params, ';TZID="?([^;:"]+)"?', 'i'))[1];
    if v_name in ('DTSTART', 'DTEND', 'RECURRENCE-ID') then
      select x.ts, x.cijeli_dan into v_start, v_all from public.ics_vrijeme(v_val, v_tzid) x;
      e := e || jsonb_build_object(lower(v_name), v_start, lower(v_name) || '_dan', v_all);
    elsif v_name = 'EXDATE' then
      foreach d in array string_to_array(v_val, ',') loop
        v_ex := v_ex || (select x.ts from public.ics_vrijeme(d, v_tzid) x);
      end loop;
    elsif v_name in ('UID', 'SUMMARY', 'LOCATION', 'DESCRIPTION', 'URL', 'RRULE', 'DURATION', 'STATUS') then
      e := e || jsonb_build_object(lower(v_name), case when v_name in ('SUMMARY', 'LOCATION', 'DESCRIPTION') then public.ics_tekst(v_val) else trim(v_val) end);
    end if;
  end loop;

  -- Najprije redovni događaji i ponavljanja, zatim izmijenjena pojedinačna ponavljanja (RECURRENCE-ID).
  for t in select x.d from ics_ev x order by (x.d ? 'recurrence-id'), x.rb loop
    e := t.d;
    v_start := (e->>'dtstart')::timestamptz;
    if v_start is null or coalesce(e->>'uid', '') = '' then continue; end if;
    v_all := coalesce((e->>'dtstart_dan')::boolean, false);
    v_end := (e->>'dtend')::timestamptz;
    if v_end is null and e ? 'duration' then
      begin v_end := v_start + (e->>'duration')::interval; exception when others then v_end := null; end;
    end if;
    if v_end is null and v_all then v_end := v_start + interval '1 day'; end if;
    if v_end is not null and v_end < v_start then v_end := null; end if;
    v_dur := v_end - v_start;

    if e ? 'recurrence-id' then
      insert into ics_tmp values (e->>'uid' || '@' || to_char((e->>'recurrence-id')::timestamptz at time zone 'UTC', 'YYYYMMDD"T"HH24MISS'),
        e->>'summary', v_start, v_end, v_all, e->>'location', e->>'description', e->>'url', upper(coalesce(e->>'status', '')) = 'CANCELLED')
      on conflict (kljuc) do update set naziv = excluded.naziv, pocetak = excluded.pocetak, kraj = excluded.kraj,
        cijeli_dan = excluded.cijeli_dan, lokacija = excluded.lokacija, opis = excluded.opis, poveznica = excluded.poveznica, otkazan = excluded.otkazan;
      continue;
    end if;

    if not (e ? 'rrule') then
      insert into ics_tmp values (e->>'uid', e->>'summary', v_start, v_end, v_all, e->>'location', e->>'description', e->>'url',
        upper(coalesce(e->>'status', '')) = 'CANCELLED') on conflict (kljuc) do nothing;
      continue;
    end if;

    -- Ponavljanje: DAILY, WEEKLY (i BYDAY), MONTHLY i YEARLY na isti dan; najviše 8 nadolazećih u 60 dana.
    v_rule := upper(e->>'rrule');
    v_freq := (regexp_match(v_rule, 'FREQ=([A-Z]+)'))[1];
    v_int := greatest(coalesce((regexp_match(v_rule, 'INTERVAL=(\d+)'))[1]::int, 1), 1);
    v_count := (regexp_match(v_rule, 'COUNT=(\d+)'))[1]::int;
    v_until := (select x.ts from public.ics_vrijeme((regexp_match(v_rule, 'UNTIL=([0-9TZ]+)'))[1], null) x);
    v_days := array(select (regexp_matches(coalesce((regexp_match(v_rule, 'BYDAY=([A-Z,]+)'))[1], ''), '(MO|TU|WE|TH|FR|SA|SU)', 'g'))[1]);
    if v_freq not in ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY') or (v_freq in ('MONTHLY', 'YEARLY') and v_rule ~ 'BY(DAY|SETPOS|MONTHDAY|WEEKNO|YEARDAY)=') then
      v_freq := 'SAMO_PRVI';
    end if;
    v_ex := array(select z::timestamptz from jsonb_array_elements_text(coalesce(e->'exdate', '[]')) z);
    v_local := v_start at time zone v_tz;
    n := 0; v_made := 0;
    for k in 0..800 loop
      exit when v_made >= 8;
      if v_freq = 'SAMO_PRVI' then exit when k > 0; v_occ := v_local;
      elsif v_freq = 'DAILY' then v_occ := v_local + make_interval(days => k * v_int);
      elsif v_freq = 'MONTHLY' then v_occ := v_local + make_interval(months => k * v_int);
      elsif v_freq = 'YEARLY' then v_occ := v_local + make_interval(years => k * v_int);
      elsif cardinality(v_days) = 0 then v_occ := v_local + make_interval(days => 7 * k * v_int);
      else
        -- tjedno, više dana: k = redni broj (tjedan * 7 + dan u tjednu)
        v_week := date_trunc('week', v_local) + make_interval(days => 7 * (k / 7) * v_int);
        v_dow := k % 7;
        if not (array['MO','TU','WE','TH','FR','SA','SU'])[v_dow + 1] = any (v_days) then continue; end if;
        v_occ := v_week + make_interval(days => v_dow) + (v_local - date_trunc('day', v_local));
        if v_occ < v_local then continue; end if;
      end if;
      v_occ_ts := v_occ at time zone v_tz;
      exit when v_until is not null and v_occ_ts > v_until;
      n := n + 1;
      exit when v_count is not null and n > v_count;
      exit when v_occ_ts > now() + interval '60 days';
      continue when v_occ_ts + coalesce(v_dur, interval '0') < now() - interval '1 day';
      continue when v_occ_ts = any (v_ex);
      insert into ics_tmp values (e->>'uid' || '@' || to_char(v_occ_ts at time zone 'UTC', 'YYYYMMDD"T"HH24MISS'),
        e->>'summary', v_occ_ts, v_occ_ts + v_dur, v_all, e->>'location', e->>'description', e->>'url',
        upper(coalesce(e->>'status', '')) = 'CANCELLED') on conflict (kljuc) do nothing;
      v_made := v_made + 1;
    end loop;
  end loop;

  return query select x.kljuc, x.naziv, x.pocetak, x.kraj, x.cijeli_dan, x.lokacija, x.opis, x.poveznica
    from ics_tmp x where not x.otkazan order by x.pocetak;
end $$;
revoke all on function public.ics_dogadaji(text) from public, anon, authenticated;

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
  m record; v_url text;
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
      -- poveznica: polje URL iz kalendara, inače prva poveznica iz opisa (npr. na ulaznice), inače stranica organizatora
      v_url := (regexp_match(coalesce(x.opis, ''), '(https?://[^\s<>"'']+)'))[1];
      if v_url ~ '^https?://(www\.)?google\.[a-z.]+/url\?' then
        v_url := (regexp_match(v_url, '[?&]q=([^&]+)'))[1];
        v_url := replace(replace(replace(replace(replace(replace(v_url, '%3A', ':'), '%2F', '/'), '%3F', '?'), '%3D', '='), '%26', '&'), '%23', '#');
      end if;
      v_url := regexp_replace(v_url, '[.,;:!?)\]]+$', '');
      v_link := case
        when x.poveznica ~ '^https?://[^\s<>"]+$' and char_length(x.poveznica) <= 300 then x.poveznica
        when v_url ~ '^https?://[^\s<>"]+$' and char_length(v_url) <= 300 then v_url
        else c.poveznica end;
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

-- Točan razlog greške vidi se uz kalendar na stranici /kalendari.
create or replace function public.kalendari_obradi_sve() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id from public.kalendari where zahtjev is not null loop
    begin
      perform public.kalendar_spremi(r.id); n := n + 1;
    exception when others then
      update public.kalendari set zahtjev = null, greska = left('Greška pri obradi kalendara: ' || sqlerrm, 300) where id = r.id;
    end;
  end loop;
  return n;
end $$;
revoke all on function public.kalendari_obradi_sve() from public, anon, authenticated;

create or replace function public.kalendar_stanje(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_g text;
begin
  if not public.je_admin() then raise exception 'Samo administrator.' using errcode = '42501'; end if;
  begin
    return public.kalendar_spremi(p_id);
  exception when others then
    v_g := left('Greška pri obradi kalendara: ' || sqlerrm, 300);
    update public.kalendari set zahtjev = null, greska = v_g where id = p_id;
    return jsonb_build_object('stanje', 'greska', 'greska', v_g);
  end;
end $$;
revoke all on function public.kalendar_stanje(uuid) from public, anon;
grant execute on function public.kalendar_stanje(uuid) to authenticated;
