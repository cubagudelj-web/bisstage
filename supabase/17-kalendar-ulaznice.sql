-- BisStage: uvoz iz kalendara uzima prvu poveznicu iz opisa događaja (npr. na ulaznice)
-- kad kalendar nema posebno polje za poveznicu (Google kalendar ga nema).
-- Pokreni u Supabaseu: SQL Editor -> New query -> zalijepi -> Run. Smije se pokrenuti i više puta.

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
