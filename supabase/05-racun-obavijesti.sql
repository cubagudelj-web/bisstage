-- BisStage: brisanje računa, postavke i obavijesti e-poštom o odgovorima na forumu
-- Pokreni jednom u Supabaseu: SQL Editor -> New query -> zalijepi -> Run.
-- Obavijesti rade tek kad u Vault dodaš tajnu "resend_api_key" (vidi README).

create extension if not exists pg_net with schema extensions;

-- 1. Postavke korisnika (vidi i mijenja samo vlasnik). Bez retka = obavijesti uključene.
create table public.postavke (
  id uuid primary key default auth.uid() references public.profili (id) on delete cascade,
  obavijesti_forum boolean not null default true
);
alter table public.postavke enable row level security;
create policy "postavke: samo svoje" on public.postavke for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke all on public.postavke from anon, authenticated;
grant select on public.postavke to authenticated;
grant insert (id, obavijesti_forum), update (id, obavijesti_forum) on public.postavke to authenticated;

-- 2. Brisanje vlastitog računa. Briše korisnika, a s njim (kaskadno) profil i sve objave.
create function public.obrisi_racun() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Za ovo se prvo prijavi.' using errcode = '42501';
  end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.obrisi_racun() from public, anon;
grant execute on function public.obrisi_racun() to authenticated;

-- 3. Obavijest autoru teme kad netko odgovori (najviše jedna po temi u 30 minuta).
create table public.obavijesti_log (
  tema uuid not null references public.teme (id) on delete cascade,
  primatelj uuid not null references public.profili (id) on delete cascade,
  poslano_at timestamptz not null default now(),
  primary key (tema, primatelj)
);
alter table public.obavijesti_log enable row level security; -- bez pravila: nedostupno preko stranice
revoke all on public.obavijesti_log from anon, authenticated;

create function public.html_esc(t text) returns text language sql immutable as $$
  select replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')
$$;

create function public.obavijest_odgovor() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_naslov text; v_autor uuid; v_email text; v_ime text; v_key text; v_html text;
begin
  select naslov, autor into v_naslov, v_autor from public.teme where id = new.tema;
  if v_autor is null or v_autor = new.autor then return new; end if;
  if exists (select 1 from public.postavke where id = v_autor and not obavijesti_forum) then return new; end if;
  if exists (select 1 from public.obavijesti_log where tema = new.tema and primatelj = v_autor
             and poslano_at > now() - interval '30 minutes') then return new; end if;
  select email into v_email from auth.users where id = v_autor;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  if v_email is null or v_key is null then return new; end if;
  select ime into v_ime from public.profili where id = new.autor;

  v_html := format(
    '<div style="font-family:Arial,sans-serif;max-width:560px">'
    '<p><strong>%s</strong> je odgovorio na tvoju temu <strong>„%s”</strong> na BisStageu:</p>'
    '<blockquote style="border-left:3px solid #2a2fd6;margin:0;padding:4px 12px;color:#333;white-space:pre-wrap">%s</blockquote>'
    '<p><a href="https://bisstage.com/tema/%s" style="color:#2a2fd6">Pogledaj odgovor</a></p>'
    '<p style="color:#666;font-size:12px">Ove obavijesti možeš isključiti u Moj račun na bisstage.com.</p></div>',
    public.html_esc(v_ime), public.html_esc(v_naslov), public.html_esc(left(new.tekst, 500)), new.tema);

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', 'BisStage <noreply@bisstage.com>',
      'to', jsonb_build_array(v_email),
      'subject', 'Novi odgovor: ' || left(v_naslov, 80),
      'html', v_html));

  insert into public.obavijesti_log (tema, primatelj) values (new.tema, v_autor)
    on conflict (tema, primatelj) do update set poslano_at = now();
  return new;
exception when others then
  return new; -- obavijest nikad ne smije spriječiti objavu odgovora
end $$;
revoke all on function public.obavijest_odgovor() from public, anon, authenticated;

create trigger odgovor_obavijest
  after insert on public.odgovori
  for each row execute function public.obavijest_odgovor();
