-- BisStage: statistika za administratora (stranica /statistika).
-- Pokreni u Supabaseu: SQL Editor -> New query -> zalijepi -> Run. Smije se pokrenuti i više puta.

create or replace function public.admin_statistika() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_danas timestamptz := date_trunc('day', now() at time zone 'Europe/Zagreb') at time zone 'Europe/Zagreb';
  v_tjedan timestamptz := now() - interval '7 days';
  v_mjesec timestamptz := now() - interval '30 days';
  v jsonb;
begin
  if not public.je_admin() then raise exception 'Samo administrator.' using errcode = '42501'; end if;

  select jsonb_build_object(
    'ukupno', count(*),
    'danas', count(*) filter (where u.created_at >= v_danas),
    'tjedan', count(*) filter (where u.created_at >= v_tjedan),
    'mjesec', count(*) filter (where u.created_at >= v_mjesec),
    'aktivni_tjedan', count(*) filter (where u.last_sign_in_at >= v_tjedan),
    'nepotvrdeni', count(*) filter (where u.email_confirmed_at is null),
    'google', count(*) filter (where coalesce(u.raw_app_meta_data->'providers', '[]'::jsonb) ? 'google' or u.raw_app_meta_data->>'provider' = 'google')
  ) into v from auth.users u;

  return jsonb_build_object(
    'korisnici', v,
    'po_danima', (
      select coalesce(jsonb_agg(jsonb_build_object('dan', d::date, 'broj', (
        select count(*) from auth.users u where (u.created_at at time zone 'Europe/Zagreb')::date = d::date)) order by d), '[]')
      from generate_series((now() at time zone 'Europe/Zagreb')::date - 29, (now() at time zone 'Europe/Zagreb')::date, interval '1 day') d),
    'novi', (
      select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (
        select u.id, p.ime, u.email, u.created_at, u.last_sign_in_at, u.email_confirmed_at is not null as potvrden,
               coalesce(u.raw_app_meta_data->>'provider', 'email') as nacin
        from auth.users u left join public.profili p on p.id = u.id
        order by u.created_at desc limit 30) x),
    'sadrzaj', jsonb_build_object(
      'oglasi', (select jsonb_build_object('ukupno', count(*), 'tjedan', count(*) filter (where created_at >= v_tjedan),
                 'aktivni', count(*) filter (where not prodano and istjece > now())) from public.oglasi),
      'poslovi', (select jsonb_build_object('ukupno', count(*), 'tjedan', count(*) filter (where created_at >= v_tjedan)) from public.poslovi),
      'teme', (select jsonb_build_object('ukupno', count(*), 'tjedan', count(*) filter (where created_at >= v_tjedan)) from public.teme),
      'odgovori', (select jsonb_build_object('ukupno', count(*), 'tjedan', count(*) filter (where created_at >= v_tjedan)) from public.odgovori),
      'oprema', (select jsonb_build_object('ukupno', count(*), 'tjedan', count(*) filter (where created_at >= v_tjedan)) from public.oprema),
      'recenzije', (select jsonb_build_object('ukupno', count(*), 'tjedan', count(*) filter (where created_at >= v_tjedan)) from public.recenzije),
      'dogadaji', (select jsonb_build_object('ukupno', count(*), 'tjedan', count(*) filter (where created_at >= v_tjedan),
                   'nadolazeci', count(*) filter (where pocetak >= now())) from public.dogadaji),
      'prijave', (select jsonb_build_object('otvorene', count(*) filter (where not rijeseno), 'ukupno', count(*)) from public.prijave)
    )
  );
end $$;
revoke all on function public.admin_statistika() from public, anon;
grant execute on function public.admin_statistika() to authenticated;
