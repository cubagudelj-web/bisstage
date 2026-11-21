# BisStage

Zajednica glazbenika iz Hrvatske i regije: oglasnik instrumenata, burza poslova, forum i ocjene opreme.

## Kako je složeno

| Dio | Gdje | Čemu služi |
|---|---|---|
| `public/` | Cloudflare Pages | Stranica koju posjetitelji vide (HTML, CSS, JavaScript, bez izgradnje) |
| `supabase/schema.sql` | Supabase | Baza podataka, sigurnosna pravila i spremište fotografija |
| `public/config.js` | | Adresa Supabase projekta i javni ključ |
| `functions/`, `lib/seo.js` | Cloudflare Pages Functions | Naslov, opis i slika za Google i pregled pri dijeljenju (`/oglas/<id>`, `/posao/<id>`, `/tema/<id>`, `/oprema/<id>`, `/dogadaj/<id>`) te `sitemap.xml` |

Javni (`sb_publishable_`) ključ smije biti u kodu. Podatke štite pravila u `schema.sql`.
Tajni ključ (`sb_secret_` ili `service_role`) nikada ne ide u ovaj repozitorij.

## Postavljanje

### 1. Baza (Supabase)
1. Supabase → **SQL Editor** → **New query**.
2. Zalijepi cijeli sadržaj `supabase/schema.sql` i klikni **Run**. Pokreće se samo jednom.
3. Na isti način, jednom, pokreni i `supabase/02-prijave.sql` (prijave neprimjerenih objava).
4. Zatim, jednom, `supabase/03-istaknuto.sql` (istaknuti oglasi i poslovi).
5. Zatim, jednom, `supabase/04-video-slike.sql` (YouTube video u oglasima, fotografija opreme).
6. Zatim, jednom, `supabase/05-racun-obavijesti.sql` (brisanje računa, postavke, obavijesti o odgovorima).
7. Zatim, jednom, `supabase/06-profilna-slika.sql` (profilna slika).
8. Zatim, jednom, `supabase/07-dogadaji.sql` (rubrika Događaji).
9. Zatim, jednom, `supabase/08-zastita-prodano.sql` (dnevna ograničenja objava, Prodano i istek oglasa).
10. Zatim, jednom, `supabase/09-studijska-oprema.sql` (kategorija Kućni studio postaje Studijska oprema).
11. Zatim, jednom, `supabase/10-forum-studio.sql` (kategorija foruma Kućni studio postaje Studio i snimanje).
12. Zatim, jednom, `supabase/11-spremljeno-podsjetnici.sql` (spremljeni oglasi i pretrage, obavijest o novom oglasu, podsjetnik prije isteka; dnevni posao u pg_cron).
13. Zatim `supabase/12-gitarske-pedale.sql` (kategorija Gitarske pedale i pojačala u ocjenama opreme).
14. Zatim `supabase/13-pedale-oglasnik.sql` (ista kategorija u oglasniku i spremljenim pretragama).
15. Zatim `supabase/14-kalendari.sql` (automatski uvoz događaja iz javnih kalendara; kalendare dodaješ na stranici `/kalendari`).
16. Zatim `supabase/15-sedam-slika.sql` (do 7 fotografija u oglasu).
17. Zatim `supabase/16-kalendar-grad.sql` (uvoz iz kalendara prepoznaje grad i državu iz adrese).

### Zaštita od botova (Cloudflare Turnstile)
1. Cloudflare → **Turnstile** → **Add widget**, hostname `bisstage.com`, način **Managed**.
2. Javni **Site key** upiši u `public/config.js` (`turnstileKljuc`) i objavi.
3. Tek zatim: Supabase → **Authentication → Attack Protection** → uključi CAPTCHA, odaberi Turnstile i upiši **Secret key**.

### Statistika posjeta
Cloudflare → Workers & Pages → `bisstage` → **Metrics** → uključi **Web Analytics**.

### Obavijesti e-poštom
U Resendu napravi API ključ (Sending access, domena bisstage.com). U Supabaseu: **Integrations → Vault → Add new secret**, naziv `resend_api_key`, vrijednost ključ. Bez toga se obavijesti jednostavno ne šalju.

### 2. Adrese za prijavu (Supabase)
**Authentication → URL Configuration**:
- **Site URL:** `https://bisstage.com`
- **Redirect URLs:** `https://bisstage.com/**` i `https://*.bisstage.pages.dev/**`

### 3. Objava (Cloudflare Pages)
1. Cloudflare → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → repozitorij `bisstage`.
2. **Framework preset:** None. **Build command:** prazno. **Build output directory:** `public`.
3. Nakon objave: **Custom domains** → dodaj `bisstage.com`.

### 4. Administrator
Nakon što se registriraš na stranici: Supabase → **Table Editor** → `profili` → u svom retku postavi `admin` na `true`.
Administrator može brisati sve objave.

## Prije javnog pokretanja
- **E-pošta:** Supabaseova ugrađena e-pošta šalje samo članovima tvog Supabase tima i najviše nekoliko poruka na sat. Za prave korisnike postavi vlastiti SMTP (Authentication → Emails → SMTP Settings).
- **Google prijava:** uključi je u Authentication → Sign In / Providers → Google, zatim u `public/config.js` postavi `googlePrijava: true`.
- **Pravila privatnosti i uvjeti korištenja** (GDPR).
- Zaštita od spama.
