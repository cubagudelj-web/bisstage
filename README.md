# BisStage

Zajednica glazbenika iz Hrvatske i regije: oglasnik instrumenata, burza poslova, forum i ocjene opreme.

## Kako je složeno

| Dio | Gdje | Čemu služi |
|---|---|---|
| `public/` | Cloudflare Pages | Stranica koju posjetitelji vide (HTML, CSS, JavaScript, bez izgradnje) |
| `supabase/schema.sql` | Supabase | Baza podataka, sigurnosna pravila i spremište fotografija |
| `public/config.js` | | Adresa Supabase projekta i javni ključ |

Javni (`sb_publishable_`) ključ smije biti u kodu. Podatke štite pravila u `schema.sql`.
Tajni ključ (`sb_secret_` ili `service_role`) nikada ne ide u ovaj repozitorij.

## Postavljanje

### 1. Baza (Supabase)
1. Supabase → **SQL Editor** → **New query**.
2. Zalijepi cijeli sadržaj `supabase/schema.sql` i klikni **Run**. Pokreće se samo jednom.
3. Na isti način, jednom, pokreni i `supabase/02-prijave.sql` (prijave neprimjerenih objava).

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
