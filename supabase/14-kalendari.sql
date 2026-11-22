-- BisStage: automatski uvoz događaja iz javnih kalendara (Google kalendar, iCal/.ics).
-- Pokreni u Supabaseu: SQL Editor -> New query -> zalijepi -> Run. Smije se pokrenuti i više puta.
-- Kalendare dodaje administrator na stranici /kalendari. Uvoz se radi svaki dan oko 4 sata ujutro
-- i odmah na gumb "Uvezi sada". Ne treba nikakav tajni ključ.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- 1. Popis kalendara (vidi i mijenja samo administrator).
create table if not exists public.kalendari (
  id uuid primary key default gen_random_uuid(),
  autor uuid not null default auth.uid() references public.profili (id) on delete cascade,
  naziv text not null check (char_length(naziv) between 2 and 120),
  url text not null check (url ~ '^https://[^\s<>"]+$' and char_length(url) <= 500),
  vrsta text not null default 'Koncert' check (vrsta in ('Koncert','Festival','Tečaj ili radionica','Jam session','Audicija ili natjecanje','Sajam opreme','Ostalo')),
  mjesto text not null check (char_length(mjesto) between 1 and 120),
  grad text not null check (char_length(grad) between 1 and 60),
  drzava text not null check (drzava in ('Hrvatska','Slovenija','Bosna i Hercegovina','Srbija','Crna Gora','Sjeverna Makedonija')),
  poveznica text check (poveznica is null or (poveznica ~ '^https?://[^\s<>"]+$' and char_length(poveznica) <= 300)),
  aktivan boolean not null default true,
  zahtjev bigint,
  zahtjev_vrijeme timestamptz,
  zadnji_uvoz timestamptz,
  zadnji_broj int,
  greska text,
  created_at timestamptz not null default now()
);
alter table public.kalendari enable row level security;
drop policy if exists "kalendari: samo administrator" on public.kalendari;
create policy "kalendari: samo administrator" on public.kalendari for all to authenticated
  using (public.je_admin()) with check (public.je_admin());
revoke all on public.kalendari from anon, authenticated;
grant select, delete on public.kalendari to authenticated;
grant insert (naziv, url, vrsta, mjesto, grad, drzava, poveznica) on public.kalendari to authenticated;
grant update (naziv, url, vrsta, mjesto, grad, drzava, poveznica, aktivan) on public.kalendari to authenticated;

-- 2. Događaji znaju iz kojeg su kalendara. Brisanjem kalendara brišu se i njegovi događaji.
alter table public.dogadaji add column if not exists kalendar uuid references public.kalendari (id) on delete cascade;
alter table public.dogadaji add column if not exists izvor_uid text;
alter table public.dogadaji add column if not exists izvor text;
alter table public.dogadaji add column if not exists cijeli_dan boolean not null default false;
create unique index if not exists dogadaji_kalendar_uid on public.dogadaji (kalendar, izvor_uid);

-- Uvezeni događaji ne broje se u dnevno ograničenje objava
-- (stupac "kalendar" korisnici ne mogu sami postaviti).
create or replace function public.ogranicenje_objava() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_novi boolean; v_granica int; v_broj int;
begin
  if public.je_admin() then return new; end if;
  if to_jsonb(new) ->> 'kalendar' is not null then return new; end if;
  select created_at > now() - interval '7 days' into v_novi from public.profili where id = new.autor;
  v_granica := case when coalesce(v_novi, true) then tg_argv[0]::int else tg_argv[1]::int end;
  execute format('select count(*) from public.%I where autor = $1 and created_at > now() - interval ''24 hours''', tg_table_name)
    into v_broj using new.autor;
  if v_broj >= v_granica then
    raise exception 'Danas si dosegao najveći broj objava u ovom dijelu stranice (%). Pokušaj ponovo sutra.', v_granica
      using errcode = 'P0001';
  end if;
  return new;
end $$;

-- 3. Čitanje .ics datoteke.
create or replace function public.ics_tekst(v text) returns text language sql immutable set search_path = '' as $$
  select replace(replace(replace(replace(replace(replace(replace(coalesce(v, ''),
    '\\', chr(1)), '\n', chr(10)), '\N', chr(10)), '\,', ','), '\;', ';'), chr(1), '\'), chr(13), '')
$$;

create or replace function public.ics_vrijeme(v text, tzid text, out ts timestamptz, out cijeli_dan boolean)
language plpgsql stable set search_path = '' as $$
declare v_tz text := 'Europe/Zagreb'; v_t timestamp;
begin
  v := trim(coalesce(v, ''));
  cijeli_dan := false;
  if v ~ '^\d{8}$' then
    cijeli_dan := true;
    ts := (substr(v, 1, 4) || '-' || substr(v, 5, 2) || '-' || substr(v, 7, 2))::timestamp at time zone v_tz;
    return;
  end if;
  if v !~ '^\d{8}T\d{6}Z?$' then ts := null; return; end if;
  v_t := (substr(v, 1, 4) || '-' || substr(v, 5, 2) || '-' || substr(v, 7, 2) || ' ' ||
          substr(v, 10, 2) || ':' || substr(v, 12, 2) || ':' || substr(v, 14, 2))::timestamp;
  if right(v, 1) = 'Z' then ts := v_t at time zone 'UTC'; return; end if;
  if tzid is not null and exists (select 1 from pg_catalog.pg_timezone_names where name = tzid) then v_tz := tzid; end if;
  ts := v_t at time zone v_tz;
exception when others then
  ts := null;
end $$;

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

-- 4. Uvoz jednog kalendara.
create or replace function public.kalendar_posalji(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_url text;
begin
  select url into v_url from public.kalendari where id = p_id;
  if v_url is null then return; end if;
  update public.kalendari set zahtjev = net.http_get(url := v_url, timeout_milliseconds := 20000),
    zahtjev_vrijeme = now() where id = p_id;
end $$;
revoke all on function public.kalendar_posalji(uuid) from public, anon, authenticated;

create or replace function public.kalendar_spremi(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.kalendari; r record; x record; v_broj int := 0; v_preskoceno int := 0; v_kljucevi text[] := '{}';
  v_naziv text; v_opis text; v_link text; v_vrsta text; v_kraj timestamptz;
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
      begin
        insert into public.dogadaji (autor, naziv, vrsta, pocetak, kraj, mjesto, grad, drzava, poveznica, opis,
                                     kalendar, izvor_uid, izvor, cijeli_dan)
        values (c.autor, v_naziv, v_vrsta, x.pocetak, v_kraj,
                coalesce(nullif(left(trim(split_part(x.lokacija, ',', 1)), 120), ''), c.mjesto), c.grad, c.drzava, v_link,
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

-- Gumbi na stranici /kalendari (samo administrator).
create or replace function public.kalendar_uvezi(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.je_admin() then raise exception 'Samo administrator.' using errcode = '42501'; end if;
  perform public.kalendar_posalji(p_id);
end $$;
revoke all on function public.kalendar_uvezi(uuid) from public, anon;
grant execute on function public.kalendar_uvezi(uuid) to authenticated;

create or replace function public.kalendar_stanje(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.je_admin() then raise exception 'Samo administrator.' using errcode = '42501'; end if;
  return public.kalendar_spremi(p_id);
end $$;
revoke all on function public.kalendar_stanje(uuid) from public, anon;
grant execute on function public.kalendar_stanje(uuid) to authenticated;

-- 5. Svakodnevni uvoz: zahtjevi u 3:00 UTC, obrada svakih 10 minuta (dok ima neobrađenih).
create or replace function public.kalendari_dohvati_sve() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id from public.kalendari where aktivan limit 100 loop
    perform public.kalendar_posalji(r.id); n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.kalendari_dohvati_sve() from public, anon, authenticated;

create or replace function public.kalendari_obradi_sve() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id from public.kalendari where zahtjev is not null loop
    begin
      perform public.kalendar_spremi(r.id); n := n + 1;
    exception when others then
      update public.kalendari set zahtjev = null, greska = 'Greška pri obradi kalendara.' where id = r.id;
    end;
  end loop;
  return n;
end $$;
revoke all on function public.kalendari_obradi_sve() from public, anon, authenticated;

select cron.schedule('bisstage-kalendari-dohvat', '0 3 * * *', 'select public.kalendari_dohvati_sve()');
select cron.schedule('bisstage-kalendari-obrada', '*/10 * * * *', 'select public.kalendari_obradi_sve()');
