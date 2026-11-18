// Zajednički kod za Cloudflare Pages Functions: priprema stranice s pravim
// naslovom, opisom i slikom za tražilice i pregled pri dijeljenju (WhatsApp, Facebook...).
// Koristi samo javni ključ i javne stupce, iste koje vidi i neprijavljeni posjetitelj.

export const SUPA = "https://livgzretoteimhcwocvk.supabase.co";
export const KEY = "sb_publishable_NyRP3eh3NfSww1sM0yYh5w_ILarcC21";

export const CSP = "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self'; font-src 'self'; img-src 'self' data: blob: https://livgzretoteimhcwocvk.supabase.co; connect-src 'self' https://livgzretoteimhcwocvk.supabase.co wss://livgzretoteimhcwocvk.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CURS = { EUR: "€", KM: "KM", RSD: "RSD", MKD: "MKD" };

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clip = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t; };
const imgUrl = path => `${SUPA}/storage/v1/object/public/slike/${String(path).split("/").map(encodeURIComponent).join("/")}`;

export async function rest(path, fetchImpl = fetch) {
  const r = await fetchImpl(`${SUPA}/rest/v1/${path}`, { headers: { apikey: KEY, Accept: "application/json" } });
  if (!r.ok) return null;
  return r.json();
}

// Opisi pojedinih vrsta stranica: koji se podaci čitaju i kako se slaže tekst.
export const KINDS = {
  oglas: {
    path: id => `oglasi?id=eq.${id}&select=naslov,opis,cijena,valuta,grad,drzava,kategorija,stanje,slike`,
    meta: o => ({
      title: o.naslov,
      price: o.cijena == null ? "Po dogovoru" : `${Number(o.cijena).toLocaleString("hr-HR")} ${CURS[o.valuta] || ""}`.trim(),
      get description() { return clip(`${this.price} · ${o.stanje} · ${[o.grad, o.drzava].filter(Boolean).join(", ")}. ${o.opis}`, 200); },
      image: o.slike?.length ? imgUrl(o.slike[0]) : null,
      body: `${o.kategorija} · ${o.stanje} · ${[o.grad, o.drzava].filter(Boolean).join(", ")}\n\n${o.opis}`,
    }),
  },
  posao: {
    path: id => `poslovi?id=eq.${id}&select=naslov,opis,vrsta,honorar,grad,drzava`,
    meta: o => ({
      title: o.naslov,
      description: clip(`${o.vrsta} · ${[o.grad, o.drzava].filter(Boolean).join(", ")} · ${o.honorar || "Honorar po dogovoru"}. ${o.opis}`, 200),
      image: null,
      body: `${o.vrsta} · ${[o.grad, o.drzava].filter(Boolean).join(", ")} · ${o.honorar || "Honorar po dogovoru"}\n\n${o.opis}`,
    }),
  },
  tema: {
    path: id => `teme_pregled?id=eq.${id}&select=naslov,tekst,kategorija,broj_odgovora`,
    meta: o => ({
      title: o.naslov,
      description: clip(`Forum · ${o.kategorija} · ${o.broj_odgovora ?? 0} odg. ${o.tekst}`, 200),
      image: null,
      body: `Forum · ${o.kategorija}\n\n${o.tekst}`,
    }),
  },
  oprema: {
    path: id => `oprema_pregled?id=eq.${id}&select=naziv,kategorija,broj_ocjena,prosjek`,
    meta: o => {
      const score = o.broj_ocjena ? `Prosječna ocjena ${Number(o.prosjek).toLocaleString("hr-HR", { maximumFractionDigits: 1 })}/5 (${o.broj_ocjena})` : "Još nema ocjena";
      return { title: `${o.naziv} – ocjene i iskustva`, description: `${o.kategorija} · ${score}. Iskustva glazbenika na BisStageu.`, image: null, body: `${o.kategorija} · ${score}` };
    },
  },
};

// Zamijeni blok <!--meta-->...<!--/meta--> i početni sadržaj stranice.
export function render(html, m, url) {
  const title = `${m.title} – BisStage`;
  const image = m.image || new URL("/og.png", url).href;
  const head = `<!--meta-->
<title>${esc(title)}</title>
<meta name="description" content="${esc(m.description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:site_name" content="BisStage">
<meta property="og:title" content="${esc(m.title)}">
<meta property="og:description" content="${esc(m.description)}">
<meta property="og:type" content="website">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(url)}">
<meta name="twitter:card" content="summary_large_image">
<!--/meta-->`;
  const body = `<article class="doc"><h1>${esc(m.title)}</h1>${m.price ? `<p><strong>${esc(m.price)}</strong></p>` : ""}<p class="prose">${esc(clip(m.body, 1200))}</p></article>`;
  return html
    .replace(/<!--meta-->[\s\S]*?<!--\/meta-->/, head)
    .replace('<main class="wrap" id="main"><div class="empty">Učitavam…</div></main>', `<main class="wrap" id="main">${body}</main>`);
}

export const securityHeaders = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

// Obrađuje zahtjev za /oglas/<id>, /posao/<id>, /tema/<id> i /oprema/<id>.
export async function handle(kind, context, fetchImpl = fetch) {
  const { request, env, params } = context;
  const page = await env.ASSETS.fetch(new URL("/", request.url));
  const html = await page.text();
  const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", ...securityHeaders };
  const id = String(params.id || "").toLowerCase();
  let out = html;
  if (UUID.test(id)) {
    try {
      const rows = await rest(KINDS[kind].path(id), fetchImpl);
      if (rows && rows[0]) {
        const url = new URL(request.url); url.search = ""; url.hash = "";
        out = render(html, KINDS[kind].meta(rows[0]), url.href);
      }
    } catch (e) { /* ako baza ne odgovori, šaljemo običnu stranicu */ }
  }
  return new Response(out, { status: 200, headers });
}
