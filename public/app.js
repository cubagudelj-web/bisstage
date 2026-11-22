"use strict";

/* ------------------------------------------------------------------ */
/* Postavke i popisi (moraju odgovarati provjerama u schema.sql)       */
/* ------------------------------------------------------------------ */
const CFG = window.BISSTAGE || {};
const COUNTRIES = ["Hrvatska", "Slovenija", "Bosna i Hercegovina", "Srbija", "Crna Gora", "Sjeverna Makedonija"];
const CATS = ["Gitare i basovi", "Gitarske pedale i pojačala", "Bubnjevi i udaraljke", "Klavijature", "Gudački", "Puhački", "Tamburice", "Ozvučenje", "Studijska oprema"];
const CONDS = ["Novo", "Kao novo", "Korišteno", "Za popravak"];
const CURS = { EUR: "€", KM: "KM", RSD: "RSD", MKD: "MKD" };
const JOBS = ["Svirka", "Stalni angažman", "Studijsko snimanje", "Poduka", "Bend traži člana"];
const TOPICS = ["Instrumenti", "Bendovi i svirke", "Studio i snimanje", "Učenje i poduka", "Razgovor"];
const PODKAT = {
  "Instrumenti": ["Gitare i basovi", "Pedale, pojačala i efekti", "Bubnjevi i udaraljke", "Klavijature", "Tamburice", "Gudački i puhački", "Servis i održavanje"],
  "Bendovi i svirke": ["Traženje članova", "Svadbe i privatne svirke", "Klubovi i nastupi", "Honorari i ugovori", "Ozvučenje i rasvjeta"],
  "Studio i snimanje": ["Kućni studio", "Mikrofoni i snimanje", "Miks i mastering", "Programi i dodaci (DAW, plugini)", "Objava glazbe i autorska prava"],
  "Učenje i poduka": ["Početnici", "Glazbena škola i akademija", "Teorija i harmonija", "Tehnika i vježbanje", "Pjevanje"],
  "Razgovor": ["Koncerti i festivali", "Nova glazba", "Glazbena scena regije", "Opušteno"],
};
const OPCENITO = "Općenito";
// jedan izbornik za kategoriju i podkategoriju: vrijednost "Kategorija|Podkategorija"
const TOPIC_OPTIONS = TOPICS.map(k => ({ group: k, options: [[k + "|", k + " › " + OPCENITO], ...PODKAT[k].map(p => [k + "|" + p, k + " › " + p])] }));
const topicPath = t => t.podkategorija ? `${t.kategorija} › ${t.podkategorija}` : t.kategorija;
const EVENT_TYPES = ["Koncert", "Festival", "Tečaj ili radionica", "Jam session", "Audicija ili natjecanje", "Sajam opreme", "Ostalo"];
const MJ = ["sij", "velj", "ožu", "tra", "svi", "lip", "srp", "kol", "ruj", "lis", "stu", "pro"];
const CRIT = [["zvuk", "Zvuk"], ["izrada", "Izrada"], ["vrijednost", "Vrijednost"]];
const MAX_SLIKA = 7;
const LIMIT = 300;

const OGLAS_JAVNO = "id,autor,naslov,kategorija,stanje,cijena,valuta,grad,drzava,opis,slike,video,prodano,istjece,istaknut_od,istaknut_do,created_at";
const POSAO_JAVNO = "id,autor,naslov,vrsta,honorar,grad,drzava,rok,opis,istaknut_od,istaknut_do,created_at";

/* ------------------------------------------------------------------ */
/* Stanje                                                              */
/* ------------------------------------------------------------------ */
let sb = null;
let session = null;
let me = null; // { id, ime, admin }
let navToken = 0;
const filters = { dogadaji: { q: "", vrsta: "", drzava: "" }, prijave: { tab: "otvorene" }, mojeObjave: { tab: "oglasi" }, oglasi: { q: "", cat: "", drzava: "" }, poslovi: { q: "", vrsta: "", drzava: "" }, forum: { q: "", kat: "", pod: "" }, ocjene: { q: "", kat: "" } };
const open = new Set();
const nameCache = new Map();
const avatarCache = new Map();

/* ------------------------------------------------------------------ */
/* Pomoćne funkcije                                                    */
/* ------------------------------------------------------------------ */
const $ = id => document.getElementById(id);
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "class") e.className = v;
    else if (k === "vars") for (const [n, val] of Object.entries(v)) e.style.setProperty(n, val);
    else if (k === "value") e.value = v;
    else if (v === true) e.setAttribute(k, "");
    else if (v != null && v !== false) e.setAttribute(k, v);
  }
  kids.flat(9).forEach(c => { if (c != null && c !== false) e.append(c); });
  return e;
}
const plural = (n, a, b, c) => {
  const t = n % 10, s = n % 100;
  return `${n} ${t === 1 && s !== 11 ? a : t >= 2 && t <= 4 && (s < 12 || s > 14) ? b : c}`;
};
const norm = s => String(s || "").toLowerCase().replace(/đ/g, "d").normalize("NFD").replace(/[̀-ͯ]/g, "");
const hit = (q, ...parts) => !q || norm(parts.join(" ")).includes(norm(q));
const date = t => t ? new Date(t).toLocaleDateString("hr-HR", { day: "numeric", month: "numeric", year: "numeric" }) : "";
const day = s => { if (!s) return ""; const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("hr-HR"); };
const dec = n => Number(n).toLocaleString("hr-HR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const price = o => o.cijena == null ? "Po dogovoru" : `${Number(o.cijena).toLocaleString("hr-HR")} ${CURS[o.valuta] || ""}`.trim();
const place = o => [o.grad, o.drzava].filter(Boolean).join(", ");
const uid = () => session?.user?.id || null;
const canDelete = o => !!me && (me.admin || o.autor === me.id);
const canEdit = o => !!me && o.autor === me.id;
const imgUrl = path => sb.storage.from("slike").getPublicUrl(path).data.publicUrl;

class UserError extends Error {}

// Kratka privremena memorija čitanja: povratak na već otvoreni dio stranice je trenutan.
// Svaka promjena (objava, uređivanje, brisanje, prijava) briše memoriju.
const qCache = new Map(), Q_TTL = 60e3;
async function q(promise) {
  const get = promise?.method === "GET" && promise.url;
  const key = get ? String(promise.url) + "|" + (promise.headers?.Prefer || promise.headers?.get?.("Prefer") || "") : null;
  if (key) {
    const hit = qCache.get(key);
    if (hit && Date.now() - hit.t < Q_TTL) return structuredClone(hit.data);
  } else if (promise?.method) qCache.clear();
  const { data, error } = await promise;
  if (error) throw error;
  if (key && data != null) { qCache.set(key, { t: Date.now(), data: structuredClone(data) }); if (qCache.size > 200) qCache.delete(qCache.keys().next().value); }
  return data;
}

function errText(e) {
  if (e instanceof UserError) return e.message;
  const code = e?.code || "";
  const msg = String(e?.message || "");
  const map = {
    invalid_credentials: "E-mail ili lozinka nisu ispravni.",
    email_not_confirmed: "Prvo potvrdi e-mail adresu. Poveznicu smo ti poslali e-poštom. Ako je ne vidiš, provjeri neželjenu poštu.",
    user_already_exists: "Ova e-mail adresa je već registrirana. Prijavi se ili zatraži novu lozinku.",
    weak_password: "Lozinka je preslaba. Upotrijebi barem 8 znakova, s brojevima i slovima.",
    same_password: "Nova lozinka mora biti drukčija od stare.",
    over_email_send_rate_limit: "Poslano je previše e-poruka. Pokušaj ponovo za sat vremena.",
    over_request_rate_limit: "Previše pokušaja. Pričekaj nekoliko minuta.",
    email_address_not_authorized: "Slanje e-pošte još nije postavljeno za ovu adresu. Javi se administratoru stranice.",
    validation_failed: "Provjeri jesu li sva polja ispravno popunjena.",
    captcha_failed: "Sigurnosna provjera nije uspjela. Osvježi stranicu i pokušaj ponovo.",
    "23505": "To već postoji. Pronađi ga na popisu.",
    "23514": "Neko polje nije ispravno popunjeno. Provjeri duljinu teksta i odabrane vrijednosti.",
    "42501": "Nemaš dozvolu za ovu radnju. Prijavi se ponovo.",
  };
  if (code === "P0001" && msg) return msg;
  if (map[code]) return map[code];
  if (/Invalid login credentials/i.test(msg)) return map.invalid_credentials;
  if (/Email not confirmed/i.test(msg)) return map.email_not_confirmed;
  if (/already registered/i.test(msg)) return map.user_already_exists;
  if (/not authorized/i.test(msg)) return map.email_address_not_authorized;
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "Nema veze s poslužiteljem. Provjeri internet i pokušaj ponovo.";
  if (code === "PGRST204" && me?.admin) return "Baza još nema novi stupac. Pokreni zadnju SQL skriptu u Supabaseu. (" + msg + ")";
  return "Nešto nije uspjelo. Pokušaj ponovo." + (me?.admin && (code || msg) ? ` (${[code, msg].filter(Boolean).join(": ")})` : "");
}

function toast(text) {
  const t = $("toast");
  t.textContent = text; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2800);
}

async function loadNames(ids) {
  const need = [...new Set(ids)].filter(i => i && !nameCache.has(i));
  for (let i = 0; i < need.length; i += 80) {
    const rows = await q(sb.from("profili").select("id,ime,slika").in("id", need.slice(i, i + 80)));
    rows.forEach(r => { nameCache.set(r.id, r.ime); avatarCache.set(r.id, r.slika || null); });
  }
}
const nameOf = id => nameCache.get(id) || "Član";
function avatar(id, size = "sm") {
  const path = avatarCache.get(id);
  if (path) return h("img", { class: "avatar " + size, src: imgUrl(path), alt: "", loading: "lazy" });
  const name = nameOf(id);
  let hash = 0; for (const ch of String(id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return h("span", { class: "avatar " + size + " initial", "aria-hidden": "true", vars: { "--hue": String(hash % 360) } }, (name.trim()[0] || "?").toUpperCase());
}
const authorLink = id => h("a", { class: "author", href: "/korisnik/" + id }, avatar(id), nameOf(id));

function needLogin() {
  if (session) return false;
  try { sessionStorage.setItem("povratak", location.pathname); } catch {}
  go("/prijava");
  toast("Za ovo se prvo prijavi");
  return true;
}

function emptyBox(title, text) {
  return h("div", { class: "empty" }, title ? h("strong", {}, title) : null, text);
}
const loading = () => emptyBox(null, "Učitavam…");

function delBtn(item, run) {
  if (!canDelete(item)) return null;
  const b = h("button", { class: "btn small danger", type: "button" }, "Izbriši");
  b.addEventListener("click", async () => {
    if (!b.dataset.armed) {
      b.dataset.armed = "1"; b.textContent = "Potvrdi brisanje"; b.className = "btn small confirm";
      setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = "Izbriši"; b.className = "btn small danger"; } }, 4000);
      return;
    }
    b.disabled = true;
    try { await run(); toast("Izbrisano"); refresh(); }
    catch (e) { b.disabled = false; toast(errText(e)); }
  });
  return b;
}

/* ------------------------------------------------------------------ */
/* Obrasci                                                             */
/* ------------------------------------------------------------------ */
function openForm({ title, submit, fields, values = {}, save, done = "Objavljeno" }) {
  const dlg = $("dlg");
  const err = h("p", { class: "err", role: "alert" });
  const send = h("button", { class: "btn", type: "submit" }, submit);
  const control = f => {
    const id = "f-" + f.name, base = { id, name: f.name, required: f.required };
    if (f.options) return h("select", base, f.placeholder != null ? h("option", { value: "" }, f.placeholder) : null,
      f.options.map(function opt(o) {
        if (o && o.group) return h("optgroup", { label: o.group }, o.options.map(opt));
        const [v, l] = Array.isArray(o) ? o : [o, o]; return h("option", { value: v, selected: String(values[f.name] ?? "") === String(v) }, l);
      }));
    if (f.type === "textarea") return h("textarea", { ...base, maxlength: f.max || 3000, value: values[f.name] || "" });
    if (f.type === "file") return h("input", { id, name: f.name, type: "file", accept: "image/jpeg,image/png,image/webp", multiple: f.multiple !== false });
    return h("input", { ...base, type: f.type || "text", maxlength: f.type === "number" || f.type === "date" ? null : f.max || 120, minlength: f.min_len, min: f.min, step: f.step, value: values[f.name] ?? "" });
  };
  const field = f => h("label", { class: "field", for: "f-" + f.name }, f.label, control(f), f.hint ? h("span", { class: "hint" }, f.hint) : null);
  const form = h("form", { method: "dialog", novalidate: false },
    h("h2", {}, title),
    fields.map(f => Array.isArray(f) ? h("div", { class: "grid2" }, f.map(field)) : field(f)),
    err,
    h("div", { class: "actions" }, send, h("button", { class: "btn quiet", type: "button", onclick: () => dlg.close() }, "Odustani")));
  form.addEventListener("submit", async ev => {
    ev.preventDefault();
    const vals = Object.fromEntries([...new FormData(form).entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, v.trim()]));
    const files = [...(form.querySelector('input[type="file"]')?.files || [])];
    send.disabled = true; err.textContent = "";
    const label = send.textContent;
    if (files.length) send.textContent = "Šaljem fotografije…";
    try { await save(vals, files); dlg.close(); toast(done); refresh(); }
    catch (e) { console.error(e); err.textContent = errText(e); send.disabled = false; send.textContent = label; }
  });
  dlg.replaceChildren(form);
  dlg.showModal();
}

async function shrink(file) {
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch { throw new UserError(`Fotografiju „${file.name}” ne mogu otvoriti. Koristi JPG, PNG ili WebP.`); }
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.82));
  if (!blob || blob.size > 2 * 1024 * 1024) throw new UserError(`Fotografija „${file.name}” je prevelika.`);
  return blob;
}

async function uploadSlike(oglasId, files) {
  if (files.length > MAX_SLIKA) throw new UserError(`Možeš dodati najviše ${MAX_SLIKA} fotografija.`);
  const paths = [];
  for (const f of files) {
    const blob = await shrink(f);
    const path = `${uid()}/${oglasId}/${crypto.randomUUID()}.jpg`;
    await q(sb.storage.from("slike").upload(path, blob, { contentType: "image/jpeg", upsert: false }));
    paths.push(path);
  }
  return paths;
}
async function uploadGearImg(opremaId, file) {
  const blob = await shrink(file);
  const path = `${uid()}/oprema/${opremaId}/${crypto.randomUUID()}.jpg`;
  await q(sb.storage.from("slike").upload(path, blob, { contentType: "image/jpeg", upsert: false }));
  return path;
}
async function removeSlike(paths) {
  if (paths?.length) { const { error } = await sb.storage.from("slike").remove(paths); if (error) console.warn(error); }
}

function ytId(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(t)) return t;
  let u;
  try { u = new URL(/^https?:\/\//i.test(t) ? t : "https://" + t); } catch { u = null; }
  const host = u ? u.hostname.replace(/^(www\.|m\.|music\.)/, "") : "";
  let id = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = u.searchParams.get("v") || (u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/) || [])[1];
  }
  if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) return id;
  throw new UserError("Poveznica na video nije ispravna. Zalijepi poveznicu s YouTubea, npr. https://youtu.be/…");
}
function videoBox(id, title) {
  const box = h("div", { class: "video" });
  const start = h("button", { class: "video-start", type: "button", onclick: () => {
    box.replaceChildren(h("iframe", { src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`, title: "Video: " + title,
      allow: "autoplay; encrypted-media; picture-in-picture; fullscreen", allowfullscreen: true, referrerpolicy: "strict-origin-when-cross-origin", loading: "lazy" }));
  } }, h("span", { class: "video-play", "aria-hidden": "true" }, "▶"), h("span", {}, "Pokreni video"), h("small", {}, "Video se učitava s YouTubea tek kad klikneš."));
  box.append(start);
  return h("div", { class: "video-wrap" }, box, h("a", { href: `https://www.youtube.com/watch?v=${id}`, target: "_blank", rel: "noopener" }, "Otvori na YouTubeu"));
}

const oglasFields = edit => [
  { name: "naslov", label: "Što prodaješ", required: true, max: 90, min_len: 3 },
  [{ name: "kategorija", label: "Kategorija", options: CATS, required: true }, { name: "stanje", label: "Stanje", options: CONDS, required: true }],
  [{ name: "cijena", label: "Cijena", type: "number", min: 0, step: "any", hint: "Ostavi prazno za dogovor." }, { name: "valuta", label: "Valuta", options: Object.keys(CURS).map(k => [k, CURS[k]]) }],
  [{ name: "grad", label: "Grad", required: true, max: 60 }, { name: "drzava", label: "Država", options: COUNTRIES, required: true }],
  { name: "opis", label: "Opis", type: "textarea", required: true },
  { name: "kontakt", label: "Kontakt", required: true, min_len: 3, hint: "Telefon ili e-mail. Vide ga samo prijavljeni korisnici." },
  { name: "video", label: "YouTube video (nije obavezno)", type: "url", max: 200, hint: "Zalijepi poveznicu s YouTubea, npr. snimku u kojoj se instrument svira." },
  { name: "slike", label: `Fotografije (najviše ${MAX_SLIKA})`, type: "file", hint: edit ? "Ako odabereš nove, zamijenit će postojeće." : "JPG, PNG ili WebP. Smanjit ćemo ih prije slanja." },
];
function oglasForm(existing) {
  if (needLogin()) return;
  openForm({
    title: existing ? "Uredi oglas" : "Novi oglas", submit: existing ? "Spremi promjene" : "Objavi oglas",
    done: existing ? "Spremljeno" : "Objavljeno", values: existing ? { ...existing, video: existing.video ? "https://youtu.be/" + existing.video : "" } : { valuta: "EUR" }, fields: oglasFields(!!existing),
    save: async (v, files) => {
      const id = existing?.id || crypto.randomUUID();
      const row = { naslov: v.naslov, kategorija: v.kategorija, stanje: v.stanje, cijena: v.cijena === "" ? null : Number(v.cijena),
        valuta: v.valuta || "EUR", grad: v.grad, drzava: v.drzava, opis: v.opis, kontakt: v.kontakt, video: ytId(v.video) };
      let old = null;
      if (files.length) { row.slike = await uploadSlike(id, files); old = existing?.slike; }
      if (existing) await q(sb.from("oglasi").update(row).eq("id", id));
      else await q(sb.from("oglasi").insert({ id, ...row, slike: row.slike || [] }));
      await removeSlike(old);
    },
  });
}
function posaoForm(existing) {
  if (needLogin()) return;
  openForm({
    title: existing ? "Uredi posao" : "Novi posao", submit: existing ? "Spremi promjene" : "Objavi posao",
    done: existing ? "Spremljeno" : "Objavljeno", values: existing || {},
    fields: [
      { name: "naslov", label: "Koga tražiš", required: true, max: 90, min_len: 3 },
      [{ name: "vrsta", label: "Vrsta", options: JOBS, required: true }, { name: "honorar", label: "Honorar", max: 40, hint: "npr. 120 € po svirci" }],
      [{ name: "grad", label: "Grad", required: true, max: 60 }, { name: "drzava", label: "Država", options: COUNTRIES, required: true }],
      { name: "rok", label: "Rok za prijavu", type: "date" },
      { name: "opis", label: "Opis", type: "textarea", required: true },
      { name: "kontakt", label: "Kontakt", required: true, min_len: 3, hint: "Telefon ili e-mail. Vide ga samo prijavljeni korisnici." }],
    save: async v => {
      const row = { naslov: v.naslov, vrsta: v.vrsta, honorar: v.honorar || null, grad: v.grad, drzava: v.drzava, rok: v.rok || null, opis: v.opis, kontakt: v.kontakt };
      if (existing) await q(sb.from("poslovi").update(row).eq("id", existing.id));
      else await q(sb.from("poslovi").insert(row));
    },
  });
}

/* ------------------------------------------------------------------ */
/* Dijelovi popisa                                                     */
/* ------------------------------------------------------------------ */
function search(id, label, st, ph) {
  return h("label", { class: "field", for: id }, label, h("input", { id, type: "search", placeholder: ph, value: st.q, oninput: e => { st.q = e.target.value; redraw(); } }));
}
function pick(id, label, st, key, opts) {
  return h("label", { class: "field", for: id }, label, h("select", { id, onchange: e => { st[key] = e.target.value; redraw(); } },
    h("option", { value: "" }, "Sve"), opts.map(o => h("option", { value: o, selected: st[key] === o }, o))));
}
function contact(o) {
  if (!session) return h("div", { class: "contact" }, h("a", { href: "/prijava", onclick: () => { try { sessionStorage.setItem("povratak", location.pathname); } catch {} } }, "Prijavi se"), " da vidiš kontakt.");
  if (!o.kontakt) return null;
  const c = h("button", { class: "btn small quiet", type: "button", onclick: async () => {
    try { await navigator.clipboard.writeText(o.kontakt); toast("Kontakt je kopiran"); } catch { toast("Označi kontakt i kopiraj ga ručno"); }
  } }, "Kopiraj");
  return h("div", { class: "contact" }, "Kontakt:", h("code", {}, o.kontakt), c);
}
function expander(key, summary, body) {
  // Otvaranjem jednog oglasa zatvaraju se ostali na istom popisu.
  const d = h("details", { "data-key": key, open: open.has(key), ontoggle: () => {
    if (!d.open) { open.delete(key); return; }
    open.add(key);
    d.parentElement?.querySelectorAll(":scope > details[open]").forEach(o => { if (o !== d) { o.open = false; open.delete(o.dataset.key); } });
    const top = d.getBoundingClientRect().top;
    if (top < 60) d.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  } }, summary);
  d.append(h("div", { class: "more" }, body));
  return d;
}
const pageHead = (title, text, btn) => h("div", { class: "head-row" }, h("div", {}, h("h1", {}, title), text ? h("p", {}, text) : null), btn);
const metaHead = (title, meta, btn) => h("div", { class: "head-row" }, h("div", {}, h("h1", {}, title), h("div", { class: "meta" }, meta)), btn);

function thumb(o) {
  if (o.slike?.length) return h("img", { class: "thumb", src: imgUrl(o.slike[0]), alt: "", loading: "lazy", width: 56, height: 56 });
  return h("span", { class: "thumb", "aria-hidden": "true" }, o.kategorija?.[0] || "♪");
}
const featured = o => !!o.istaknut_do && new Date(o.istaknut_do) > new Date();
const featTag = o => featured(o) ? h("span", { class: "tag feat" }, "Istaknuto") : null;
const featFirst = rows => [...rows].sort((a, b) => (featured(b) - featured(a)) || (featured(a) && featured(b) ? new Date(b.istaknut_od) - new Date(a.istaknut_od) : 0));
// Oglas je aktivan dok nije prodan i dok nije istekao.
const activeAds = query => query.eq("prodano", false).gt("istjece", new Date().toISOString());
const adState = o => o.prodano ? "prodano" : (o.istjece && new Date(o.istjece) < new Date() ? "isteklo" : "aktivan");
async function withFeatured(tbl, cols, rows) {
  let fq = sb.from(tbl).select(cols).gt("istaknut_do", new Date().toISOString());
  if (tbl === "oglasi") fq = activeAds(fq);
  const feat = await q(fq.order("istaknut_od", { ascending: false }).limit(50));
  const ids = new Set(rows.map(r => r.id));
  return featFirst([...feat.filter(f => !ids.has(f.id)), ...rows]);
}
function heartBtn(o) {
  if (me && o.autor === me.id) return null;
  const on = savedAds.has(o.id);
  return h("button", { class: "btn small heart" + (on ? " on" : ""), type: "button", "aria-pressed": String(on), onclick: async e => {
    if (needLogin()) return;
    const b = e.currentTarget; b.disabled = true;
    try {
      if (savedAds.has(o.id)) { await q(sb.from("spremljeni").delete().eq("oglas", o.id)); savedAds.delete(o.id); toast("Uklonjeno iz spremljenih"); }
      else { await q(sb.from("spremljeni").insert({ oglas: o.id })); savedAds.add(o.id); toast("Spremljeno. Pronaći ćeš ga u Moj račun."); }
      const now = savedAds.has(o.id);
      b.className = "btn small heart" + (now ? " on" : ""); b.setAttribute("aria-pressed", String(now)); b.textContent = now ? "♥ Spremljeno" : "♡ Spremi";
    } catch (x) { toast(errText(x)); }
    b.disabled = false;
  } }, on ? "♥ Spremljeno" : "♡ Spremi");
}
function soldBtns(o) {
  if (!canEdit(o)) return [];
  const st = adState(o);
  const act = (label, fn, done) => h("button", { class: "btn small quiet", type: "button", onclick: async e => {
    const b = e.currentTarget; b.disabled = true;
    try { await fn(); toast(done); refresh(); } catch (x) { toast(errText(x)); b.disabled = false; }
  } }, label);
  const extend = act("Produlji za 60 dana", () => q(sb.rpc("produlji_oglas", { objekt: o.id })), "Oglas je produljen");
  if (st === "prodano") return [act("Vrati u prodaju", () => q(sb.rpc("produlji_oglas", { objekt: o.id })), "Oglas je ponovo aktivan")];
  if (st === "isteklo") return [extend];
  const soon = new Date(o.istjece) - new Date() < 7 * 864e5;
  return [act("Označi kao prodano", () => q(sb.from("oglasi").update({ prodano: true }).eq("id", o.id)), "Oglas je označen kao prodan"), soon ? extend : null];
}
function featureBtns(tbl, o) {
  const label = tbl === "oglasi" ? "oglas" : "posao";
  const until = featured(o) ? h("span", { class: "tag feat" }, "Istaknuto do " + date(o.istaknut_do)) : null;
  const run = async dana => {
    const d = await q(sb.rpc("istakni", { tablica: tbl, objekt: o.id, dana }));
    toast(d ? `Istaknuto do ${date(d)}` : "Isticanje je uklonjeno");
    refresh();
  };
  const own = canEdit(o) && !featured(o) ? h("button", { class: "btn small feat-btn", type: "button", onclick: async e => {
    const btn = e.currentTarget; btn.disabled = true;
    try { await run(7); } catch (x) { toast(errText(x)); btn.disabled = false; }
  } }, `Istakni ${label} na 7 dana · besplatno`) : null;
  const admin = me?.admin ? h("button", { class: "btn small quiet", type: "button", onclick: () => openForm({
    title: "Isticanje (administrator)", submit: "Spremi", done: "Spremljeno",
    fields: [{ name: "dana", label: "Trajanje", required: true, options: [["7", "7 dana"], ["14", "14 dana"], ["30", "30 dana"], ["0", "Ukloni isticanje"]] }],
    save: async v => { const d = await q(sb.rpc("istakni", { tablica: tbl, objekt: o.id, dana: Number(v.dana) })); return d; } }) }, "Isticanje") : null;
  return [until, own, admin];
}
const adRow = (o, tag = "summary", href) => h(tag, { class: "row thumbed" + (featured(o) ? " featured" : ""), href }, thumb(o), h("h3", {}, o.naslov),
  h("div", { class: "value" }, price(o)),
  h("div", { class: "meta" }, savedAds.has(o.id) ? h("span", { class: "saved-mark", title: "Spremljeno" }, "♥") : null, adState(o) === "prodano" ? h("span", { class: "tag sold" }, "Prodano") : adState(o) === "isteklo" ? h("span", { class: "tag sold" }, "Isteklo") : null, featTag(o), o.video ? h("span", { class: "tag" }, "▶ video") : null, h("span", {}, o.kategorija), h("span", {}, o.stanje), h("span", {}, place(o)), h("span", {}, nameOf(o.autor)), h("span", {}, date(o.created_at))));
const jobRow = (o, tag = "summary", href) => h(tag, { class: "row" + (featured(o) ? " featured" : ""), href }, h("h3", {}, o.naslov),
  h("div", { class: "value" }, o.honorar || "Po dogovoru"),
  h("div", { class: "meta" }, featTag(o), h("span", {}, o.vrsta), h("span", {}, place(o)), o.rok ? h("span", {}, "Rok: " + day(o.rok)) : null, h("span", {}, nameOf(o.autor)), h("span", {}, date(o.created_at))));
const threadRow = t => h("a", { class: "row", href: "/tema/" + t.id }, h("h3", {}, t.naslov),
  h("div", { class: "value" }, String(t.broj_odgovora ?? 0), h("small", {}, "odg.")),
  h("div", { class: "meta" }, h("span", {}, topicPath(t)), h("span", {}, nameOf(t.autor)), h("span", {}, date(t.created_at))));
const bars = g => h("div", { class: "bars" }, CRIT.map(([k, l]) => h("div", { class: "bar" }, h("span", {}, l),
  h("i", {}, h("b", { vars: { "--w": `${(Number(g[k]) || 0) / 5 * 100}%` } })), h("span", {}, g.broj_ocjena ? dec(g[k]) : "–"))));
const scoreBox = g => h("div", { class: "score" }, g.broj_ocjena ? dec(g.prosjek) : "–", h("small", {}, plural(g.broj_ocjena || 0, "ocjena", "ocjene", "ocjena")));
const gearCard = g => h("a", { class: "gear-card", href: "/oprema/" + g.id }, g.slika ? h("img", { class: "gear-img", src: imgUrl(g.slika), alt: "", loading: "lazy" }) : null, scoreBox(g), h("h3", {}, g.naziv), h("div", { class: "meta" }, h("span", {}, g.kategorija)), bars(g));
const fill = (el, items, emptyEl) => el.replaceChildren(...(items.length ? items : [emptyEl]));

function adBody(o) {
  return [
    o.slike?.length ? h("div", { class: "gallery" }, o.slike.map((p, i) => h("button", { type: "button", class: "thumb-btn", "aria-label": `Otvori fotografiju ${i + 1} od ${o.slike.length}`, onclick: () => openGallery(o.slike, i, o.naslov) },
      h("img", { src: imgUrl(p), alt: o.naslov, loading: "lazy" })))) : null,
    o.video ? videoBox(o.video, o.naslov) : null,
    adState(o) !== "aktivan" ? h("p", { class: "notice-box" }, adState(o) === "prodano" ? "Ovaj je oglas označen kao prodan." : "Ovaj je oglas istekao i više se ne prikazuje na popisu.") : null,
    h("p", {}, o.opis), h("p", { class: "by" }, "Objavio: ", authorLink(o.autor)), contact(o),
    canEdit(o) && o.istjece && adState(o) === "aktivan" ? h("p", { class: "hint" }, "Oglas ističe " + date(o.istjece) + ".") : null,
    h("div", { class: "actions" },
      ...(adState(o) === "aktivan" ? featureBtns("oglasi", o) : []),
      heartBtn(o),
      ...soldBtns(o),
      canEdit(o) ? h("button", { class: "btn small quiet", type: "button", onclick: () => oglasForm(o) }, "Uredi") : null,
      delBtn(o, async () => { await removeSlike(o.slike); await q(sb.from("oglasi").delete().eq("id", o.id)); }),
      reportBtn("oglas", o, "/oglas/" + o.id, o.naslov)),
  ];
}
const RAZLOZI = ["Spam ili reklama", "Prijevara ili lažna objava", "Uvredljiv sadržaj", "Nezakonit sadržaj", "Ne pripada ovdje", "Drugo"];
function reportBtn(vrsta, item, poveznica, naslov) {
  if (me && item.autor === me.id) return null;
  return h("button", { class: "btn small quiet report", type: "button", onclick: () => {
    if (needLogin()) return;
    openForm({ title: "Prijavi objavu", submit: "Pošalji prijavu", done: "Hvala, prijava je poslana",
      fields: [{ name: "razlog", label: "Razlog", options: RAZLOZI, placeholder: "Odaberi", required: true },
        { name: "napomena", label: "Napomena (nije obavezno)", type: "textarea", max: 500, hint: "Što nije u redu s ovom objavom?" }],
      save: async v => {
        try { await q(sb.from("prijave").insert({ vrsta, objekt: item.id, poveznica: poveznica.replace(/^\/([a-z]+)\//, "#$1-"), naslov: String(naslov || "Objava").slice(0, 200), razlog: v.razlog, napomena: v.napomena || null })); }
        catch (e) { if (e?.code === "23505") throw new UserError("Ovu si objavu već prijavio. Administrator će je pregledati."); throw e; }
      } });
  } }, "Prijavi");
}

function openGallery(paths, start, title) {
  const dlg = $("dlg");
  let i = start, x0 = null;
  const img = h("img", { class: "lb-img", alt: title });
  const count = h("span", { class: "lb-count" });
  const show = () => { img.src = imgUrl(paths[i]); count.textContent = `${i + 1} / ${paths.length}`; };
  const go = d => { i = (i + d + paths.length) % paths.length; show(); };
  const many = paths.length > 1;
  const stage = h("div", { class: "lb-stage",
    ontouchstart: e => { x0 = e.touches[0].clientX; },
    ontouchend: e => { if (x0 == null || !many) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); x0 = null; } },
    img,
    many ? h("button", { class: "lb-nav lb-prev", type: "button", "aria-label": "Prethodna fotografija", onclick: () => go(-1) }, "‹") : null,
    many ? h("button", { class: "lb-nav lb-next", type: "button", "aria-label": "Sljedeća fotografija", onclick: () => go(1) }, "›") : null);
  const bar = h("div", { class: "lb-bar" }, h("span", { class: "lb-title" }, title), many ? count : null,
    h("button", { class: "lb-close", type: "button", "aria-label": "Zatvori", onclick: () => dlg.close() }, "×"));
  const onKey = e => { if (!many) return; if (e.key === "ArrowLeft") go(-1); if (e.key === "ArrowRight") go(1); };
  dlg.replaceChildren(bar, stage);
  dlg.classList.add("lightbox");
  dlg.addEventListener("keydown", onKey);
  dlg.addEventListener("close", () => { dlg.classList.remove("lightbox"); dlg.removeEventListener("keydown", onKey); }, { once: true });
  dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); }, { once: true });
  show();
  dlg.showModal();
}

/* Pozadinska animacija zaglavlja: zvučni valovi i note koje se lagano dižu. */
function bandFx(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w = 0, hgt = 0, dpr = 1, raf = 0, t0 = performance.now();
  const notes = Array.from({ length: 9 }, (_, i) => ({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 0.8, v: 0.012 + Math.random() * 0.018, ph: Math.random() * 6.28, g: i % 3 === 0 ? "♫" : "♪" }));
  const size = () => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = canvas.clientWidth; hgt = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const draw = now => {
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, w, hgt);
    // valovi u gornjem dijelu, iza naslova
    const lines = 7, top = hgt * 0.08, span = hgt * 0.42;
    for (let i = 0; i < lines; i++) {
      const base = top + span * (i / (lines - 1));
      const amp = 6 + 10 * Math.sin(i * 0.9 + t * 0.35) ** 2;
      const k = 0.006 + i * 0.0007, sp = 0.6 + i * 0.12;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 6) {
        const env = 0.35 + 0.65 * (x / w);
        const y = base + Math.sin(x * k - t * sp + i) * amp * env + Math.sin(x * k * 2.3 + t * 0.4) * amp * 0.25 * env;
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.strokeStyle = `rgba(255,255,255,${0.06 + 0.05 * (i % 3)})`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    // note koje se dižu s desne strane
    ctx.fillStyle = "rgba(255,200,61,0.28)";
    for (const n of notes) {
      const y = ((n.y - t * n.v) % 1 + 1) % 1;
      const x = 0.45 + n.x * 0.55 + Math.sin(t * 0.6 + n.ph) * 0.015;
      ctx.globalAlpha = Math.sin(y * Math.PI);
      ctx.font = `${Math.round(16 * n.s + 10)}px serif`;
      ctx.fillText(n.g, x * w, y * hgt * 0.45 + hgt * 0.08);
    }
    ctx.globalAlpha = 1;
  };
  const loop = now => {
    if (!canvas.isConnected) return;
    if (!document.hidden) draw(now);
    raf = requestAnimationFrame(loop);
  };
  size();
  if (typeof ResizeObserver === "function") new ResizeObserver(() => { size(); if (still) draw(t0 + 4000); }).observe(canvas);
  if (still) draw(t0 + 4000); else raf = requestAnimationFrame(loop);
}

/* ---------------- Događaji: pomoćne funkcije ---------------- */
const pad = n => String(n).padStart(2, "0");
const toLocalInput = iso => { if (!iso) return ""; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const hm = d => `${d.getHours()}:${pad(d.getMinutes())}`;
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
function whenText(e) {
  const a = new Date(e.pocetak), b = e.kraj ? new Date(e.kraj) : null;
  const dl = d => d.toLocaleDateString("hr-HR", { weekday: "long", day: "numeric", month: "numeric", year: "numeric" });
  if (e.cijeli_dan) return !b || sameDay(a, b) ? dl(a) : `${a.toLocaleDateString("hr-HR")} – ${b.toLocaleDateString("hr-HR")}`;
  if (!b) return `${dl(a)} u ${hm(a)}`;
  if (sameDay(a, b)) return `${dl(a)}, ${hm(a)} – ${hm(b)}`;
  return `${a.toLocaleDateString("hr-HR")} ${hm(a)} – ${b.toLocaleDateString("hr-HR")} ${hm(b)}`;
}
function dayLabel(e, today) {
  const a = new Date(e.pocetak);
  if (a < today) return "U tijeku";
  const diff = Math.round((dayStart(a) - today) / 864e5);
  if (diff === 0) return "Danas";
  if (diff === 1) return "Sutra";
  const t = a.toLocaleDateString("hr-HR", { weekday: "long", day: "numeric", month: "long" });
  return t[0].toUpperCase() + t.slice(1);
}
const dateTile = e => { const a = new Date(e.pocetak); return h("span", { class: "date-tile", "aria-hidden": "true" }, h("b", {}, a.getDate()), h("small", {}, MJ[a.getMonth()])); };
const eventRow = e => h("a", { class: "row event", href: "/dogadaj/" + e.id }, dateTile(e), h("h3", {}, e.naziv),
  h("div", { class: "value" }, e.ulaz || ""),
  h("div", { class: "meta" }, h("span", { class: "tag" }, e.vrsta), e.cijeli_dan ? null : h("span", {}, hm(new Date(e.pocetak))), h("span", {}, e.mjesto), h("span", {}, place(e))));
const upcoming = () => {
  const today = dayStart(new Date()).toISOString(), now = new Date().toISOString();
  return sb.from("dogadaji").select("*").or(`pocetak.gte.${today},kraj.gte.${now}`).order("pocetak");
};
function calLinks(e) {
  const a = new Date(e.pocetak), b = e.kraj ? new Date(e.kraj) : new Date(a.getTime() + 2 * 36e5);
  const z = d => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const where = [e.mjesto, e.grad, e.drzava].filter(Boolean).join(", ");
  const url = location.origin + "/dogadaj/" + e.id;
  const g = "https://calendar.google.com/calendar/render?" + new URLSearchParams({ action: "TEMPLATE", text: e.naziv, dates: `${z(a)}/${z(b)}`, location: where, details: url });
  const icsEsc = t => String(t).replace(/\\/g, "\\\\").replace(/[,;]/g, m => "\\" + m).replace(/\r?\n/g, "\\n");
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//BisStage//HR", "BEGIN:VEVENT", `UID:${e.id}@bisstage.com`, `DTSTAMP:${z(new Date())}`,
    `DTSTART:${z(a)}`, `DTEND:${z(b)}`, `SUMMARY:${icsEsc(e.naziv)}`, `LOCATION:${icsEsc(where)}`, `URL:${url}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const icsHref = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  return [h("a", { class: "btn small quiet", href: g, target: "_blank", rel: "noopener" }, "Dodaj u Google kalendar"),
    h("a", { class: "btn small quiet", href: icsHref, download: "bisstage-dogadaj.ics" }, "Preuzmi za kalendar (.ics)")];
}
function calForm(existing) {
  openForm({
    title: existing ? "Uredi kalendar" : "Dodaj kalendar", submit: existing ? "Spremi" : "Dodaj kalendar", done: existing ? "Spremljeno" : "Kalendar je dodan. Klikni Uvezi sada.",
    values: existing || { drzava: "Hrvatska", vrsta: "Koncert" },
    fields: [
      { name: "naziv", label: "Organizator", required: true, max: 120, min_len: 2, hint: "Prikazuje se uz svaki događaj, npr. Klub Boogaloo" },
      { name: "url", label: "Javna adresa kalendara (iCal, .ics)", type: "url", required: true, max: 500,
        hint: "Google kalendar: Postavke kalendara → Integriraj kalendar → Javna adresa u iCal formatu. Kalendar mora biti javan." },
      { name: "vrsta", label: "Vrsta događaja", options: EVENT_TYPES, required: true, hint: "Festivali, jam sessioni i radionice prepoznaju se i po nazivu." },
      { name: "mjesto", label: "Mjesto održavanja", required: true, max: 120, hint: "Mjesto, grad i država koriste se kad ih adresa događaja u kalendaru ne otkriva." },
      [{ name: "grad", label: "Grad", required: true, max: 60 }, { name: "drzava", label: "Država", options: COUNTRIES, required: true }],
      { name: "poveznica", label: "Web stranica organizatora (nije obavezno)", type: "url", max: 300 }],
    save: async v => {
      let url = String(v.url || "").trim().replace(/^webcal:\/\//i, "https://");
      if (!/^https:\/\/[^\s<>"]+$/.test(url)) throw new UserError("Adresa kalendara mora počinjati s https://");
      let link = v.poveznica || null;
      if (link && !/^https?:\/\//i.test(link)) link = "https://" + link;
      if (link && !/^https?:\/\/[^\s<>"]+$/.test(link)) throw new UserError("Poveznica nije ispravna.");
      const row = { naziv: v.naziv, url, vrsta: v.vrsta, mjesto: v.mjesto, grad: v.grad, drzava: v.drzava, poveznica: link };
      if (existing) await q(sb.from("kalendari").update(row).eq("id", existing.id));
      else await q(sb.from("kalendari").insert(row));
    },
  });
}
/* Automatski BisStage plakat za događaje bez fotografije (1200 × 630, kao pregled pri dijeljenju). */
const POSTER_BOJE = { "Koncert": "#2a2fd6", "Festival": "#c2410c", "Tečaj ili radionica": "#0f766e", "Jam session": "#6d28d9",
  "Audicija ili natjecanje": "#be185d", "Sajam opreme": "#166534", "Ostalo": "#15173c" };
function autoPoster(e) {
  const img = h("img", { alt: "Plakat: " + e.naziv, width: 1200, height: 630 });
  drawPoster(e).then(c => { img.src = c.toDataURL("image/jpeg", 0.9); }).catch(() => img.remove());
  return img;
}
async function drawPoster(e) {
  try { await Promise.all(["800 90px 'Bricolage Grotesque'", "600 40px 'Instrument Sans'", "700 26px 'JetBrains Mono'"].map(f => document.fonts.load(f))); } catch {}
  const W = 1200, H = 630, c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d");
  x.fillStyle = POSTER_BOJE[e.vrsta] || "#2a2fd6"; x.fillRect(0, 0, W, H);
  x.fillStyle = "#ffc83d"; x.beginPath(); x.arc(1110, 40, 230, 0, Math.PI * 2); x.fill();
  x.fillStyle = "rgba(255,255,255,.14)"; x.beginPath(); x.arc(990, 330, 34, 0, Math.PI * 2); x.fill();
  x.textBaseline = "alphabetic";
  x.fillStyle = "#ffffff"; x.font = "800 34px 'Bricolage Grotesque', Arial, sans-serif"; x.fillText("BisStage", 72, 92);
  x.fillStyle = "#ffc83d"; x.font = "700 24px 'JetBrains Mono', monospace"; x.fillText(String(e.vrsta || "Događaj").toUpperCase(), 72, 142);
  // naziv: najviše 3 retka, slova se smanjuju dok ne stane
  const maxW = 820, words = String(e.naziv || "").split(/\s+/).filter(Boolean);
  let size = 96, lines = [];
  for (; size >= 44; size -= 4) {
    x.font = `800 ${size}px 'Bricolage Grotesque', Arial, sans-serif`;
    lines = []; let line = "";
    for (const w of words) {
      const t = line ? line + " " + w : w;
      if (x.measureText(t).width <= maxW || !line) line = t; else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    if (lines.length <= 3 && lines.every(l => x.measureText(l).width <= maxW)) break;
  }
  if (lines.length > 3) { lines = lines.slice(0, 3); lines[2] = lines[2].replace(/\s*\S*$/, "") + "…"; }
  x.fillStyle = "#ffffff";
  const lh = size * 1.02, top = 160 + (3 - lines.length) * lh * 0.35;
  lines.forEach((l, i) => x.fillText(l, 72, top + lh * (i + 1)));
  // datum i mjesto
  const a = new Date(e.pocetak);
  let kad = a.toLocaleDateString("hr-HR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  kad = kad[0].toUpperCase() + kad.slice(1) + (e.cijeli_dan ? "" : ` · ${hm(a)}`);
  const gdje = [...new Set([e.mjesto, e.grad].filter(Boolean))].join(", ");
  const fit = (t, font, w) => { x.font = font; if (x.measureText(t).width <= w) return t; while (t && x.measureText(t + "…").width > w) t = t.slice(0, -1); return t + "…"; };
  x.fillStyle = "#ffc83d"; x.fillText(fit(kad, "600 40px 'Instrument Sans', Arial, sans-serif", W - 144), 72, 528);
  x.fillStyle = "#ffffff"; x.fillText(fit(gdje, "400 32px 'Instrument Sans', Arial, sans-serif", W - 400), 72, 576);
  x.fillStyle = "rgba(255,255,255,.75)"; x.font = "700 22px 'JetBrains Mono', monospace"; x.textAlign = "right"; x.fillText("bisstage.com", W - 72, 576);
  return c;
}
function eventForm(existing) {
  if (needLogin()) return;
  openForm({
    title: existing ? "Uredi događaj" : "Novi događaj", submit: existing ? "Spremi promjene" : "Objavi događaj", done: existing ? "Spremljeno" : "Objavljeno",
    values: existing ? { ...existing, pocetak: toLocalInput(existing.pocetak), kraj: toLocalInput(existing.kraj) } : {},
    fields: [
      { name: "naziv", label: "Naziv događaja", required: true, max: 120, min_len: 3 },
      { name: "vrsta", label: "Vrsta", options: EVENT_TYPES, placeholder: "Odaberi", required: true },
      [{ name: "pocetak", label: "Početak", type: "datetime-local", required: true }, { name: "kraj", label: "Završetak (nije obavezno)", type: "datetime-local" }],
      { name: "izvor", label: "Organizator (nije obavezno)", max: 120, hint: "npr. Koncertna dvorana Vatroslava Lisinskog. Ako ostaviš prazno, uz događaj piše samo tko ga je objavio." },
      { name: "mjesto", label: "Mjesto održavanja", required: true, max: 120, hint: "npr. Dom kulture, klub Boogaloo, Trg bana Jelačića" },
      [{ name: "grad", label: "Grad", required: true, max: 60 }, { name: "drzava", label: "Država", options: COUNTRIES, required: true }],
      { name: "ulaz", label: "Ulaz (nije obavezno)", max: 60, hint: "npr. Besplatno, 10 €, pretprodaja 8 €" },
      { name: "poveznica", label: "Poveznica za ulaznice ili više informacija (nije obavezno)", type: "url", max: 300 },
      { name: "opis", label: "Opis", type: "textarea", required: true },
      { name: "plakat", label: "Plakat ili fotografija (nije obavezno)", type: "file", multiple: false, hint: existing?.plakat && !existing.plakat_auto ? "Ako odabereš novu, zamijenit će postojeću." : "Bez fotografije stranica sama napravi BisStage plakat. Dodaj samo sliku za koju imaš pravo objave." },
      ...(existing?.plakat && !existing.plakat_auto ? [{ name: "slika", label: "Postojeća fotografija", options: [["zadrzi", "Zadrži"], ["auto", "Ukloni i koristi BisStage plakat"]] }] : [])],
    save: async (v, files) => {
      const start = new Date(v.pocetak), end = v.kraj ? new Date(v.kraj) : null;
      if (isNaN(start)) throw new UserError("Upiši datum i vrijeme početka.");
      if (end && end < start) throw new UserError("Završetak ne može biti prije početka.");
      if (!existing && start < new Date(Date.now() - 864e5)) throw new UserError("Početak je u prošlosti. Provjeri datum.");
      let link = v.poveznica || null;
      if (link && !/^https?:\/\//i.test(link)) link = "https://" + link;
      if (link && !/^https?:\/\/[^\s<>"]+$/.test(link)) throw new UserError("Poveznica nije ispravna.");
      const id = existing?.id || crypto.randomUUID();
      const row = { naziv: v.naziv, vrsta: v.vrsta, pocetak: start.toISOString(), kraj: end ? end.toISOString() : null, mjesto: v.mjesto, grad: v.grad, drzava: v.drzava,
        ulaz: v.ulaz || null, poveznica: link, opis: v.opis, izvor: (v.izvor || "").trim() || null };
      let old = null;
      const mine = (existing?.autor || uid()) === uid(); // slika se sprema u mapu autora
      if (files[0]) {
        const blob = await shrink(files[0]);
        row.plakat = `${uid()}/dogadaji/${id}/${crypto.randomUUID()}.jpg`;
        await q(sb.storage.from("slike").upload(row.plakat, blob, { contentType: "image/jpeg", upsert: false }));
        row.plakat_auto = false;
        old = existing?.plakat;
      } else if (mine && (!existing?.plakat || existing.plakat_auto || v.slika === "auto")) {
        // automatski plakat: novi događaj, događaj bez slike ili promijenjeni podaci
        const canvas = await drawPoster({ ...existing, ...row });
        const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", 0.9));
        if (blob) {
          row.plakat = `${uid()}/dogadaji/${id}/${crypto.randomUUID()}.jpg`;
          await q(sb.storage.from("slike").upload(row.plakat, blob, { contentType: "image/jpeg", upsert: false }));
          row.plakat_auto = true;
          old = existing?.plakat;
        }
      }
      if (existing) await q(sb.from("dogadaji").update(row).eq("id", id));
      else await q(sb.from("dogadaji").insert({ id, ...row }));
      if (old) await removeSlike([old]);
    },
  });
}

function jobBody(o) {
  return [h("p", {}, o.opis), h("p", { class: "by" }, "Objavio: ", authorLink(o.autor)), contact(o), h("div", { class: "actions" },
    ...featureBtns("poslovi", o),
    canEdit(o) ? h("button", { class: "btn small quiet", type: "button", onclick: () => posaoForm(o) }, "Uredi") : null,
    delBtn(o, () => q(sb.from("poslovi").delete().eq("id", o.id))),
    reportBtn("posao", o, "/posao/" + o.id, o.naslov))];
}

/* ------------------------------------------------------------------ */
/* Stranice                                                            */
/* ------------------------------------------------------------------ */
let redraw = () => {};

const views = {
  async pocetna(_, alive) {
    const door = (href, label, y, stem, cls, key) => h("a", { class: "door " + cls, href: "/" + href, vars: { "--y": y, "--stem": stem } },
      cls.includes("low") ? h("span", { class: "ledger" }) : null, h("span", { class: "stem" }), h("span", { class: "head" }, h("span", { "data-c": key }, "–")), h("span", { class: "label" }, label));
    const fx = h("canvas", { class: "band-fx", "aria-hidden": "true" });
    $("hero").replaceChildren(h("section", { class: "band" }, fx, h("div", { class: "wrap" },
      h("div", {}, h("h1", {}, "BisStage"), h("p", { class: "lead" }, "Kupi i prodaj instrumente, nađi svirku, pitaj kolege, ocijeni opremu i saznaj gdje se svira. Za glazbenike iz Hrvatske i regije.")),
      h("nav", { class: "staff", "aria-label": "Dijelovi stranice" },
        door("oglasi", "Oglasnik", 5.5, 2.5, "low", "oglasi"), door("poslovi", "Burza poslova", 4.5, 1.5, "", "poslovi"),
        door("forum", "Forum", 3.5, .5, "", "teme"), door("ocjene", "Ocjene opreme", 2, 2, "down", "oprema"), door("dogadaji", "Događaji", 1, 1, "down", "dogadaji")))));
    bandFx(fx);
    const box = (title, href, cls = "rows") => { const list = h("div", { class: cls }, loading()); return [list, h("section", {}, h("h2", {}, title, h("a", { href: "/" + href }, "Sve")), list)]; };
    const [a, as] = box("Novi oglasi", "oglasi"), [j, js] = box("Novi poslovi", "poslovi"), [t, ts] = box("Na forumu", "forum"), [g, gs] = box("Najbolje ocijenjeno", "ocjene", "stack");
    const featList = h("div", { class: "feat-grid" });
    const featSec = h("section", { class: "feat-sec", hidden: true }, h("h2", {}, "Istaknuti oglasi", h("a", { href: "/oglasi" }, "Svi oglasi")), featList);
    const evList = h("div", { class: "rows" });
    const evSec = h("section", { class: "feat-sec", hidden: true }, h("h2", {}, "Uskoro", h("a", { href: "/dogadaji" }, "Svi događaji")), evList);
    $("main").replaceChildren(featSec, evSec, h("div", { class: "home" }, as, js, ts, gs));

    const newest = (tbl, cols, n = 3) => q((tbl === "oglasi" ? activeAds(sb.from(tbl).select(cols)) : sb.from(tbl).select(cols)).order("created_at", { ascending: false }).limit(n));
    const count = tbl => (tbl === "oglasi" ? activeAds(sb.from(tbl).select("id", { count: "exact", head: true })) : sb.from(tbl).select("id", { count: "exact", head: true })).then(r => r.count ?? "–");
    const [og, po, te, ft, op, ...counts] = await Promise.all([
      newest("oglasi", OGLAS_JAVNO), newest("poslovi", POSAO_JAVNO), newest("teme_pregled", "*"),
      q(activeAds(sb.from("oglasi").select(OGLAS_JAVNO)).gt("istaknut_do", new Date().toISOString()).order("istaknut_od", { ascending: false }).limit(4)),
      q(sb.from("oprema_pregled").select("*").gt("broj_ocjena", 0).order("prosjek", { ascending: false }).limit(2)),
      count("oglasi"), count("poslovi"), count("teme"), count("oprema"),
      upcoming().limit(4).then(r => r.data || []).catch(() => []),
    ]);
    const ev = counts.pop();
    await loadNames([...og, ...po, ...te, ...ft].map(x => x.autor));
    if (!alive()) return;
    ["oglasi", "poslovi", "teme", "oprema"].forEach((k, i) => { const el = document.querySelector(`[data-c="${k}"]`); if (el) el.textContent = counts[i]; });
    featSec.hidden = !ft.length;
    evSec.hidden = !ev.length;
    evList.replaceChildren(...ev.map(eventRow));
    const dc = document.querySelector('[data-c="dogadaji"]'); if (dc) dc.textContent = ev.length >= 4 ? "4+" : ev.length;
    featList.replaceChildren(...ft.map(o => h("a", { class: "feat-card", href: "/oglas/" + o.id },
      o.slike?.length ? h("img", { src: imgUrl(o.slike[0]), alt: "", loading: "lazy" }) : h("span", { class: "feat-ph", "aria-hidden": "true" }, "♪"),
      h("span", { class: "tag feat" }, "Istaknuto"), h("strong", {}, o.naslov), h("span", { class: "value" }, price(o)), h("span", { class: "meta" }, place(o)))));
    fill(a, og.map(o => adRow(o, "a", "/oglas/" + o.id)), emptyBox("Još nema oglasa", "Objavi prvi oglas u Oglasniku."));
    fill(j, po.map(o => jobRow(o, "a", "/posao/" + o.id)), emptyBox("Još nema poslova", "Objavi prvi posao na Burzi poslova."));
    fill(t, te.map(threadRow), emptyBox("Još nema tema", "Otvori prvu temu na Forumu."));
    fill(g, op.map(gearCard), emptyBox("Još nema ocjena", "Dodaj opremu u Ocjenama opreme."));
  },

  async dogadaji(_, alive) {
    const st = filters.dogadaji, list = h("div", { class: "stack" }, loading());
    $("main").replaceChildren(
      pageHead("Događaji", "Koncerti, festivali, tečajevi, jam sessioni i audicije u Hrvatskoj i regiji.", h("div", { class: "actions" },
        me?.admin ? h("a", { class: "btn quiet", href: "/kalendari" }, "Kalendari") : null,
        h("button", { class: "btn", type: "button", onclick: () => eventForm() }, "Dodaj događaj"))),
      h("div", { class: "tools" }, search("q-dogadaji", "Pretraži", st, "npr. jazz, Rijeka"), pick("v-dogadaji", "Vrsta", st, "vrsta", EVENT_TYPES), pick("d-dogadaji", "Država", st, "drzava", COUNTRIES)),
      list);
    const rows = await q(upcoming().limit(LIMIT));
    if (!alive()) return;
    redraw = () => {
      const today = dayStart(new Date());
      const shown = rows.filter(e => (!st.vrsta || e.vrsta === st.vrsta) && (!st.drzava || e.drzava === st.drzava) && hit(st.q, e.naziv, e.opis, e.grad, e.mjesto));
      const groups = new Map();
      shown.forEach(e => { const k = dayLabel(e, today); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); });
      fill(list, [...groups].map(([k, es]) => h("section", { class: "day-group" }, h("h2", {}, k), h("div", { class: "rows" }, es.map(eventRow)))),
        rows.length ? emptyBox("Nema takvih događaja", "Promijeni pretragu ili filtre.") : emptyBox("Još nema najavljenih događaja", "Organiziraš koncert, tečaj ili jam session? Dodaj ga."));
    };
    redraw();
  },

  async dogadaj(id, alive) {
    $("main").replaceChildren(h("a", { class: "back", href: "/dogadaji" }, "Natrag na događaje"), loading());
    const [e] = await q(sb.from("dogadaji").select("*").eq("id", id).limit(1));
    if (e) await loadNames([e.autor]);
    if (!alive()) return;
    if (!e) { $("main").replaceChildren(h("a", { class: "back", href: "/dogadaji" }, "Natrag na događaje"), emptyBox("Ovaj događaj više ne postoji", "Pogledaj ostale događaje.")); return; }
    setTitle(e.naziv);
    const endOf = e.kraj ? new Date(e.kraj) : new Date(dayStart(new Date(e.pocetak)).getTime() + 864e5);
    const past = endOf < new Date();
    $("main").replaceChildren(h("a", { class: "back", href: "/dogadaji" }, "Natrag na događaje"),
      h("div", { class: "event-page" },
        e.plakat ? h("button", { type: "button", class: "thumb-btn poster", "aria-label": "Povećaj plakat", onclick: () => openGallery([e.plakat], 0, e.naziv) }, h("img", { src: imgUrl(e.plakat), alt: "Plakat: " + e.naziv }))
          : h("div", { class: "poster" }, autoPoster(e)),
        h("div", { class: "stack" },
          h("div", { class: "head-row" }, h("div", {}, h("span", { class: "tag" }, e.vrsta), h("h1", {}, e.naziv))),
          past ? h("p", { class: "err" }, "Ovaj je događaj završio.") : null,
          h("dl", { class: "facts" },
            h("dt", {}, "Kada"), h("dd", {}, whenText(e)),
            h("dt", {}, "Gdje"), h("dd", {}, [e.mjesto, e.grad, e.drzava].filter(Boolean).join(", ")),
            e.ulaz ? [h("dt", {}, "Ulaz"), h("dd", {}, e.ulaz)] : null,
            e.izvor ? [h("dt", {}, "Organizator"), h("dd", {}, e.izvor)] : null,
            e.kalendar ? null : [h("dt", {}, "Objavio"), h("dd", {}, authorLink(e.autor))]),
          e.kalendar ? h("p", { class: "hint" }, "Događaj je preuzet iz organizatorova javnog kalendara. Provjeri pojedinosti kod organizatora.") : null,
          e.poveznica ? h("div", {}, h("a", { class: "btn", href: e.poveznica, target: "_blank", rel: "noopener nofollow ugc" }, "Ulaznice i više informacija")) : null,
          h("p", { class: "prose" }, e.opis),
          past ? null : h("div", { class: "actions" }, ...calLinks(e)),
          h("div", { class: "actions" },
            canEdit(e) ? h("button", { class: "btn small quiet", type: "button", onclick: () => eventForm(e) }, "Uredi") : null,
            delBtn(e, async () => { await removeSlike(e.plakat ? [e.plakat] : []); await q(sb.from("dogadaji").delete().eq("id", e.id)); go("/dogadaji"); }),
            reportBtn("dogadaj", e, "/dogadaj/" + e.id, e.naziv)))));
  },

  async oglasi(_, alive) {
    const st = filters.oglasi, list = h("div", { class: "rows" }, loading());
    $("main").replaceChildren(
      pageHead("Oglasnik", "Instrumenti i oprema, novi i rabljeni.", h("button", { class: "btn", type: "button", onclick: () => oglasForm() }, "Objavi oglas")),
      h("div", { class: "tools" }, search("q-oglasi", "Pretraži", st, "npr. tambura, Split"), pick("c-oglasi", "Kategorija", st, "cat", CATS), pick("d-oglasi", "Država", st, "drzava", COUNTRIES)),
      list);
    const cols = session ? OGLAS_JAVNO + ",kontakt" : OGLAS_JAVNO;
    const rows = await withFeatured("oglasi", cols, await q(activeAds(sb.from("oglasi").select(cols)).order("created_at", { ascending: false }).limit(LIMIT)));
    await loadNames(rows.map(r => r.autor));
    if (!alive()) return;
    const saveSearch = h("button", { class: "btn small quiet", type: "button", onclick: async e => {
      if (needLogin()) return;
      const b = e.currentTarget; b.disabled = true;
      try {
        await q(sb.from("pretrage").insert({ q: st.q.trim().slice(0, 80), kategorija: st.cat || null, drzava: st.drzava || null }));
        toast("Pretraga je spremljena. Javit ćemo ti e-poštom kad se pojavi novi oglas.");
      } catch (x) { toast(errText(x)); }
      b.disabled = false;
    } }, "🔔 Javi mi kad se pojavi novi oglas za ovu pretragu");
    const saveRow = h("div", { class: "save-search" }, saveSearch);
    list.before(saveRow);
    const drawList = () => fill(list, rows.filter(o => (!st.cat || o.kategorija === st.cat) && (!st.drzava || o.drzava === st.drzava) && hit(st.q, o.naslov, o.opis, o.grad))
      .map(o => expander("o" + o.id, adRow(o), adBody(o))), rows.length ? emptyBox("Nema takvih oglasa", "Promijeni pretragu ili filtre.") : emptyBox("Još nema oglasa", "Objavi prvi oglas."));
    redraw = () => { saveRow.hidden = !(st.q.trim() || st.cat || st.drzava); drawList(); };
    redraw();
  },

  async poslovi(_, alive) {
    const st = filters.poslovi, list = h("div", { class: "rows" }, loading());
    $("main").replaceChildren(
      pageHead("Burza poslova", "Svirke, angažmani, snimanja, poduka i bendovi koji traže člana.", h("button", { class: "btn", type: "button", onclick: () => posaoForm() }, "Objavi posao")),
      h("div", { class: "tools" }, search("q-poslovi", "Pretraži", st, "npr. bubnjar, Zagreb"), pick("v-poslovi", "Vrsta", st, "vrsta", JOBS), pick("d-poslovi", "Država", st, "drzava", COUNTRIES)),
      list);
    const cols = session ? POSAO_JAVNO + ",kontakt" : POSAO_JAVNO;
    const rows = await withFeatured("poslovi", cols, await q(sb.from("poslovi").select(cols).order("created_at", { ascending: false }).limit(LIMIT)));
    await loadNames(rows.map(r => r.autor));
    if (!alive()) return;
    redraw = () => fill(list, rows.filter(o => (!st.vrsta || o.vrsta === st.vrsta) && (!st.drzava || o.drzava === st.drzava) && hit(st.q, o.naslov, o.opis, o.grad))
      .map(o => expander("p" + o.id, jobRow(o), jobBody(o))), rows.length ? emptyBox("Nema takvih poslova", "Promijeni pretragu ili filtre.") : emptyBox("Još nema poslova", "Objavi prvi posao."));
    redraw();
  },

  async forum(_, alive) {
    const st = filters.forum, list = h("div", { class: "rows" }, loading()), chips = h("div", { class: "chips" }), subs = h("div");
    const newTopic = () => {
      if (needLogin()) return;
      openForm({ title: "Nova tema", submit: "Otvori temu", values: { mjesto: st.kat ? st.kat + "|" + (st.pod && st.pod !== OPCENITO ? st.pod : "") : "" },
        fields: [{ name: "naslov", label: "Naslov", required: true, max: 120, min_len: 3 },
          { name: "mjesto", label: "Kategorija", options: TOPIC_OPTIONS, placeholder: "Odaberi", required: true },
          { name: "tekst", label: "Tekst", type: "textarea", required: true, max: 5000 }],
        save: v => { const [kategorija, pod] = v.mjesto.split("|"); return q(sb.from("teme").insert({ naslov: v.naslov, kategorija, podkategorija: pod || null, tekst: v.tekst })); } });
    };
    $("main").replaceChildren(pageHead("Forum", "Pitanja, savjeti i razgovori među glazbenicima.", h("button", { class: "btn", type: "button", onclick: newTopic }, "Otvori temu")),
      h("div", { class: "tools one" }, search("q-forum", "Pretraži teme", st, "npr. ozvučenje, svadba"), h("span")), chips, subs, list);
    const allRows = await q(sb.from("teme_pregled").select("*").order("created_at", { ascending: false }).limit(LIMIT));
    await loadNames(allRows.map(r => r.autor));
    const all = st.kat ? allRows.filter(t => t.kategorija === st.kat) : [];
    const rows = !st.kat ? allRows : all.filter(t => !st.pod || (st.pod === OPCENITO ? !t.podkategorija : t.podkategorija === st.pod));
    if (!alive()) return;
    const pick = (kat, pod) => () => { st.kat = kat; st.pod = pod; refresh(); };
    chips.replaceChildren(...["", ...TOPICS].map(k => h("button", { class: "chip", type: "button", "aria-pressed": String((st.kat || "") === k), onclick: pick(k, "") }, k || "Sve teme")));
    if (st.kat) {
      const stat = {};
      for (const t of all) { const k = t.podkategorija || OPCENITO; const x = stat[k] ||= { n: 0, zadnja: null }; x.n++; if (!x.zadnja || t.created_at > x.zadnja) x.zadnja = t.created_at; }
      const item = (pod, label) => {
        const x = pod ? stat[pod] || { n: 0 } : { n: all.length };
        return h("li", {}, h("button", { type: "button", class: "subcat" + (x.n ? "" : " empty"), "aria-pressed": String((st.pod || "") === pod), onclick: pick(st.kat, pod) },
          h("span", { class: "subcat-name" }, label), h("span", { class: "subcat-n" }, plural(x.n, "tema", "teme", "tema")),
          h("span", { class: "subcat-date" }, x.zadnja ? "zadnja " + date(x.zadnja) : "")));
      };
      subs.replaceChildren(h("nav", { class: "subcats", "aria-label": "Podkategorije: " + st.kat }, h("ul", {},
        item("", "Sve u kategoriji " + st.kat), ...PODKAT[st.kat].map(p => item(p, p)), stat[OPCENITO] ? item(OPCENITO, OPCENITO) : null)));
    } else subs.replaceChildren();
    redraw = () => {
      fill(list, rows.filter(t => hit(st.q, t.naslov, t.tekst)).map(threadRow),
        rows.length ? emptyBox("Nema takvih tema", "Promijeni pretragu ili kategoriju, ili otvori novu temu.")
          : emptyBox(st.kat ? "Ovdje još nema tema" : "Još nema tema", "Otvori prvu temu."));
    };
    redraw();
  },

  async tema(id, alive) {
    const box = h("div", { class: "stack" }, loading()), list = h("div", { class: "stack" });
    $("main").replaceChildren(h("a", { class: "back", href: "/forum" }, "Natrag na forum"), box, list);
    const [t] = await q(sb.from("teme").select("*").eq("id", id).limit(1));
    if (!t) { if (alive()) box.replaceChildren(emptyBox("Ova tema više ne postoji", "Vrati se na forum.")); return; }
    const rs = await q(sb.from("odgovori").select("*").eq("tema", id).order("created_at"));
    await loadNames([t.autor, ...rs.map(r => r.autor)]);
    if (!alive()) return;
    setTitle(t.naslov);
    const toCat = (kat, pod) => () => { filters.forum.kat = kat; filters.forum.pod = pod; go("/forum"); };
    const move = () => openForm({ title: "Premjesti temu", submit: "Premjesti", done: "Tema je premještena",
      values: { mjesto: t.kategorija + "|" + (t.podkategorija || "") },
      fields: [{ name: "mjesto", label: "Kategorija", options: TOPIC_OPTIONS, required: true }],
      save: async v => { const [k, pd] = v.mjesto.split("|"); await q(sb.rpc("premjesti_temu", { p_id: t.id, p_kategorija: k, p_podkategorija: pd || "" })); } });
    const canMove = session && (t.autor === uid() || me?.admin);
    box.replaceChildren(metaHead(t.naslov, [
        h("span", {}, h("a", { href: "/forum", onclick: e => { e.preventDefault(); toCat(t.kategorija, "")(); } }, t.kategorija),
          t.podkategorija ? [" › ", h("a", { href: "/forum", onclick: e => { e.preventDefault(); toCat(t.kategorija, t.podkategorija)(); } }, t.podkategorija)] : null),
        authorLink(t.autor), h("span", {}, date(t.created_at))]),
      h("article", { class: "post" }, h("p", { class: "prose" }, t.tekst), h("div", { class: "actions" },
        canMove ? h("button", { class: "btn small quiet", type: "button", onclick: move }, "Premjesti") : null,
        delBtn(t, async () => { await q(sb.from("teme").delete().eq("id", t.id)); go("/forum"); }), reportBtn("tema", t, "/tema/" + t.id, t.naslov))));
    let form;
    if (session) {
      const ta = h("textarea", { id: "reply-text", required: true, maxlength: 3000 });
      const err = h("p", { class: "err", role: "alert" });
      const send = h("button", { class: "btn", type: "submit" }, "Odgovori");
      form = h("form", { class: "reply", onsubmit: async e => {
        e.preventDefault(); send.disabled = true; err.textContent = "";
        try { await q(sb.from("odgovori").insert({ tema: id, tekst: ta.value.trim() })); toast("Odgovor je objavljen"); refresh(); }
        catch (x) { err.textContent = errText(x); send.disabled = false; }
      } }, h("label", { class: "field", for: "reply-text" }, "Tvoj odgovor", ta), err, h("div", {}, send));
    } else {
      form = h("p", {}, h("a", { href: "/prijava", onclick: () => { try { sessionStorage.setItem("povratak", location.pathname); } catch {} } }, "Prijavi se"), " da odgovoriš.");
    }
    list.replaceChildren(h("h2", {}, plural(rs.length, "odgovor", "odgovora", "odgovora")),
      ...rs.map(r => h("article", { class: "post" }, h("div", { class: "meta" }, authorLink(r.autor), h("span", {}, date(r.created_at))), h("p", { class: "prose" }, r.tekst),
        h("div", { class: "actions" }, delBtn(r, () => q(sb.from("odgovori").delete().eq("id", r.id))), reportBtn("odgovor", r, "/tema/" + t.id, "Odgovor u temi: " + t.naslov)))), form);
  },

  async ocjene(_, alive) {
    const st = filters.ocjene, list = h("div", { class: "gear" }, loading());
    const add = () => {
      if (needLogin()) return;
      openForm({ title: "Nova oprema", submit: "Dodaj opremu", done: "Dodano",
        fields: [{ name: "naziv", label: "Proizvođač i model", required: true, max: 90, min_len: 2 }, { name: "kategorija", label: "Kategorija", options: CATS, required: true },
          { name: "slika", label: "Fotografija (nije obavezno)", type: "file", multiple: false, hint: "Tvoja fotografija ovog modela. Ne koristi tuđe slike s interneta." }],
        save: async (v, files) => {
          const id = crypto.randomUUID();
          const slika = files[0] ? await uploadGearImg(id, files[0]) : null;
          try { await q(sb.from("oprema").insert({ id, naziv: v.naziv, kategorija: v.kategorija, slika })); }
          catch (e) { await removeSlike(slika ? [slika] : []); throw e; }
        } });
    };
    $("main").replaceChildren(
      pageHead("Ocjene opreme", "Svaki model ocjenjuje se od 1 do 5 za zvuk, izradu i vrijednost za novac.", h("button", { class: "btn", type: "button", onclick: add }, "Dodaj opremu")),
      h("div", { class: "tools one" }, search("q-ocjene", "Pretraži", st, "npr. pojačalo"), pick("k-ocjene", "Kategorija", st, "kat", CATS)),
      list);
    const rows = await q(sb.from("oprema_pregled").select("*").order("broj_ocjena", { ascending: false }).order("prosjek", { ascending: false, nullsFirst: false }).limit(LIMIT));
    if (!alive()) return;
    redraw = () => fill(list, rows.filter(g => (!st.kat || g.kategorija === st.kat) && hit(st.q, g.naziv)).map(gearCard),
      rows.length ? emptyBox("Nema takve opreme", "Promijeni pretragu ili dodaj model.") : emptyBox("Još nema opreme", "Dodaj prvi model."));
    redraw();
  },

  async oprema(id, alive) {
    const box = h("div", { class: "stack" }, loading()), list = h("div", { class: "stack" });
    $("main").replaceChildren(h("a", { class: "back", href: "/ocjene" }, "Natrag na ocjene"), box, list);
    const [g] = await q(sb.from("oprema_pregled").select("*").eq("id", id).limit(1));
    if (!g) { if (alive()) box.replaceChildren(emptyBox("Ova oprema više ne postoji", "Vrati se na ocjene.")); return; }
    const rs = await q(sb.from("recenzije").select("*").eq("oprema", id).order("created_at", { ascending: false }));
    await loadNames(rs.map(r => r.autor));
    if (!alive()) return;
    const mine = rs.find(r => r.autor === uid());
    const rate = () => {
      if (needLogin()) return;
      const nums = ["1", "2", "3", "4", "5"];
      openForm({ title: mine ? "Promijeni ocjenu" : "Ocijeni opremu", submit: "Spremi ocjenu", done: "Ocjena je spremljena", values: mine || {},
        fields: [[{ name: "zvuk", label: "Zvuk", options: nums, placeholder: "Odaberi", required: true }, { name: "izrada", label: "Izrada", options: nums, placeholder: "Odaberi", required: true }],
          { name: "vrijednost", label: "Vrijednost za novac", options: nums, placeholder: "Odaberi", required: true },
          { name: "tekst", label: "Tvoje iskustvo", type: "textarea", required: true }],
        save: v => {
          const row = { zvuk: +v.zvuk, izrada: +v.izrada, vrijednost: +v.vrijednost, tekst: v.tekst };
          return mine ? q(sb.from("recenzije").update(row).eq("id", mine.id)) : q(sb.from("recenzije").insert({ oprema: id, ...row }));
        } });
    };
    setTitle(g.naziv);
    box.replaceChildren(metaHead(g.naziv, [h("span", {}, g.kategorija)], h("button", { class: "btn", type: "button", onclick: rate }, mine ? "Promijeni ocjenu" : "Ocijeni")),
      g.slika ? h("button", { type: "button", class: "thumb-btn gear-hero", "aria-label": "Povećaj fotografiju", onclick: () => openGallery([g.slika], 0, g.naziv) }, h("img", { src: imgUrl(g.slika), alt: g.naziv })) : null,
      h("div", { class: "post" }, scoreBox(g), bars(g), h("div", { class: "actions" },
        canEdit(g) ? h("button", { class: "btn small quiet", type: "button", onclick: () => openForm({ title: g.slika ? "Promijeni fotografiju" : "Dodaj fotografiju", submit: "Spremi fotografiju", done: "Fotografija je spremljena",
          fields: [{ name: "slika", label: "Fotografija", type: "file", multiple: false, hint: "Tvoja fotografija ovog modela. Ne koristi tuđe slike s interneta." }],
          save: async (v, files) => {
            if (!files[0]) throw new UserError("Odaberi fotografiju.");
            const path = await uploadGearImg(g.id, files[0]);
            await q(sb.from("oprema").update({ slika: path }).eq("id", g.id));
            await removeSlike(g.slika ? [g.slika] : []);
          } }) }, g.slika ? "Promijeni fotografiju" : "Dodaj fotografiju") : null,
        delBtn(g, async () => { await removeSlike(g.slika ? [g.slika] : []); await q(sb.from("oprema").delete().eq("id", g.id)); go("/ocjene"); }), reportBtn("oprema", g, "/oprema/" + g.id, g.naziv))));
    list.replaceChildren(h("h2", {}, "Iskustva korisnika"),
      ...(rs.length ? rs.map(r => h("article", { class: "post" },
        h("div", { class: "meta" }, authorLink(r.autor), h("span", {}, date(r.created_at)), ...CRIT.map(([k, l]) => h("span", {}, `${l} ${r[k]}/5`))),
        h("p", { class: "prose" }, r.tekst), h("div", { class: "actions" }, delBtn(r, () => q(sb.from("recenzije").delete().eq("id", r.id))), reportBtn("recenzija", r, "/oprema/" + g.id, "Ocjena za: " + g.naziv)))) : [emptyBox("Još nema ocjena", "Budi prvi koji će ocijeniti ovaj model.")]));
  },

  async oglas(id, alive) {
    $("main").replaceChildren(h("a", { class: "back", href: "/oglasi" }, "Natrag na oglasnik"), loading());
    const [o] = await q(sb.from("oglasi").select(session ? OGLAS_JAVNO + ",kontakt" : OGLAS_JAVNO).eq("id", id).limit(1));
    if (o) await loadNames([o.autor]);
    if (!alive()) return;
    if (o) setTitle(o.naslov);
    $("main").replaceChildren(h("a", { class: "back", href: "/oglasi" }, "Natrag na oglasnik"), !o ? emptyBox("Ovaj oglas više ne postoji", "Možda je prodano. Pogledaj ostale oglase.") :
      h("div", { class: "stack" }, metaHead(o.naslov, [h("span", {}, o.kategorija), h("span", {}, o.stanje), h("span", {}, place(o)), authorLink(o.autor), h("span", {}, date(o.created_at))], h("div", { class: "value big" }, price(o))),
        h("article", { class: "post" }, adBody(o))));
  },

  async posao(id, alive) {
    $("main").replaceChildren(h("a", { class: "back", href: "/poslovi" }, "Natrag na burzu poslova"), loading());
    const [o] = await q(sb.from("poslovi").select(session ? POSAO_JAVNO + ",kontakt" : POSAO_JAVNO).eq("id", id).limit(1));
    if (o) await loadNames([o.autor]);
    if (!alive()) return;
    if (o) setTitle(o.naslov);
    $("main").replaceChildren(h("a", { class: "back", href: "/poslovi" }, "Natrag na burzu poslova"), !o ? emptyBox("Ovaj posao više ne postoji", "Pogledaj ostale poslove.") :
      h("div", { class: "stack" }, metaHead(o.naslov, [h("span", {}, o.vrsta), h("span", {}, place(o)), o.rok ? h("span", {}, "Rok: " + day(o.rok)) : null, authorLink(o.autor), h("span", {}, date(o.created_at))], h("div", { class: "value big" }, o.honorar || "Po dogovoru")),
        h("article", { class: "post" }, jobBody(o))));
  },

  async prijave(_, alive) {
    if (!me?.admin) { go("/"); return; }
    const st = filters.prijave, list = h("div", { class: "stack" }, loading()), chips = h("div", { class: "chips" });
    $("main").replaceChildren(pageHead("Prijave", "Objave koje su korisnici prijavili. Otvori objavu, izbriši je ako krši pravila i označi prijavu kao riješenu."), chips, list);
    const rows = await q(sb.from("prijave").select("*").order("created_at", { ascending: false }).limit(LIMIT));
    await loadNames(rows.map(r => r.autor));
    if (!alive()) return;
    const solve = (r, val) => async () => { try { await q(sb.from("prijave").update({ rijeseno: val }).eq("id", r.id)); await updateReportCount(); refresh(); } catch (e) { toast(errText(e)); } };
    redraw = () => {
      const open = rows.filter(r => !r.rijeseno).length;
      chips.replaceChildren(...[["otvorene", `Otvorene (${open})`], ["rijesene", `Riješene (${rows.length - open})`]].map(([k, l]) =>
        h("button", { class: "chip", type: "button", "aria-pressed": String(st.tab === k), onclick: () => { st.tab = k; redraw(); } }, l)));
      const shown = rows.filter(r => st.tab === "rijesene" ? r.rijeseno : !r.rijeseno);
      fill(list, shown.map(r => h("article", { class: "post" },
        h("div", { class: "meta" }, h("span", { class: "tag" }, r.vrsta), h("span", {}, r.razlog), h("span", {}, "prijavio: " + nameOf(r.autor)), h("span", {}, date(r.created_at))),
        h("h3", {}, r.naslov),
        r.napomena ? h("p", { class: "prose" }, r.napomena) : null,
        h("div", { class: "actions" }, h("a", { class: "btn small", href: r.poveznica.replace(/^#([a-z]+)-/, "/$1/") }, "Otvori objavu"),
          r.rijeseno ? h("button", { class: "btn small quiet", type: "button", onclick: solve(r, false) }, "Vrati u otvorene")
            : h("button", { class: "btn small quiet", type: "button", onclick: solve(r, true) }, "Označi riješeno")))),
        emptyBox(st.tab === "rijesene" ? "Nema riješenih prijava" : "Nema otvorenih prijava", st.tab === "rijesene" ? "" : "Sve je u redu."));
    };
    redraw();
  },

  async statistika(_, alive) {
    if (!me?.admin) { go("/"); return; }
    const body = h("div", { class: "stack" }, loading());
    $("main").replaceChildren(pageHead("Statistika", "Korisnici i objave na BisStageu. Ovu stranicu vidiš samo ti kao administrator."), body);
    let d;
    try { d = await q(sb.rpc("admin_statistika")); } catch (e) { body.replaceChildren(h("p", { class: "err" }, errText(e))); return; }
    if (!alive()) return;
    const k = d.korisnici, c = d.sadrzaj;
    const tile = (n, label, sub) => h("div", { class: "stat" }, h("b", {}, String(n ?? 0)), h("span", {}, label), sub ? h("small", {}, sub) : null);
    const when = t => t ? new Date(t).toLocaleString("hr-HR", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
    const max = Math.max(1, ...d.po_danima.map(x => x.broj));
    const dayLbl = s => { const [y, m, dd] = s.split("-"); return `${+dd}. ${+m}.`; };
    const rows = [
      ["Oglasi", c.oglasi, `aktivnih: ${c.oglasi.aktivni}`, "/oglasi"],
      ["Poslovi", c.poslovi, "", "/poslovi"],
      ["Teme na forumu", c.teme, "", "/forum"],
      ["Odgovori na forumu", c.odgovori, "", null],
      ["Oprema u ocjenama", c.oprema, "", "/ocjene"],
      ["Ocjene opreme", c.recenzije, "", null],
      ["Događaji", c.dogadaji, `nadolazećih: ${c.dogadaji.nadolazeci}`, "/dogadaji"],
    ];
    body.replaceChildren(
      h("h2", {}, "Korisnici"),
      h("div", { class: "stat-grid" },
        tile(k.ukupno, "registriranih ukupno", k.google ? `od toga ${k.google} preko Googlea` : null),
        tile(k.danas, "novih danas"),
        tile(k.tjedan, "novih u 7 dana"),
        tile(k.mjesec, "novih u 30 dana"),
        tile(k.aktivni_tjedan, "prijavljenih u 7 dana"),
        tile(k.nepotvrdeni, "nisu potvrdili e-mail", k.nepotvrdeni ? "poruka im je možda u neželjenoj pošti" : null)),
      h("h2", {}, "Nove registracije po danima (30 dana)"),
      h("div", { class: "chart-bars", role: "img", "aria-label": "Broj novih registracija po danima" },
        ...d.po_danima.map(x => h("div", { class: "chart-bar", title: `${dayLbl(x.dan)}: ${x.broj}` },
          x.broj ? h("em", {}, String(x.broj)) : null, h("i", { style: `height:${Math.round(x.broj / max * 85)}%` })))),
      h("div", { class: "chart-axis" }, h("span", {}, dayLbl(d.po_danima[0].dan)), h("span", {}, "danas")),
      h("h2", {}, "Objave"),
      h("div", { class: "table-wrap" }, h("table", { class: "stats" },
        h("thead", {}, h("tr", {}, h("th", {}, "Rubrika"), h("th", { class: "num" }, "Ukupno"), h("th", { class: "num" }, "Novih u 7 dana"), h("th", {}, ""))),
        h("tbody", {}, ...rows.map(([n, v, extra, href]) => h("tr", {},
          h("td", {}, href ? h("a", { href }, n) : n), h("td", { class: "num" }, String(v.ukupno)), h("td", { class: "num" }, String(v.tjedan)), h("td", { class: "muted" }, extra))),
          h("tr", {}, h("td", {}, h("a", { href: "/prijave" }, "Prijave neprimjerenih objava")), h("td", { class: "num" }, String(c.prijave.ukupno)), h("td", { class: "num" }, ""), h("td", { class: c.prijave.otvorene ? "err" : "muted" }, `otvorenih: ${c.prijave.otvorene}`))))),
      h("h2", {}, "Zadnje registracije"),
      h("div", { class: "table-wrap" }, h("table", { class: "stats" },
        h("thead", {}, h("tr", {}, h("th", {}, "Korisnik"), h("th", {}, "E-mail"), h("th", {}, "Način"), h("th", {}, "Registriran"), h("th", {}, "Zadnja prijava"), h("th", {}, "Potvrđen"))),
        h("tbody", {}, ...d.novi.map(u => h("tr", {},
          h("td", {}, u.ime ? h("a", { href: "/korisnik/" + u.id }, u.ime) : "—"), h("td", {}, u.email || "—"),
          h("td", {}, u.nacin === "google" ? "Google" : "E-mail"), h("td", {}, when(u.created_at)), h("td", {}, when(u.last_sign_in_at)),
          h("td", { class: u.potvrden ? "" : "muted" }, u.potvrden ? "da" : "čeka potvrdu")))))),
      h("p", { class: "hint" }, "Broj posjeta (i onih koji se nisu registrirali) vidiš u Cloudflareu: Workers & Pages → bisstage → Metrics → Web Analytics."));
  },
  async kalendari(_, alive) {
    if (!me?.admin) { go("/"); return; }
    const list = h("div", { class: "stack" }, loading());
    $("main").replaceChildren(h("a", { class: "back", href: "/dogadaji" }, "Natrag na događaje"),
      pageHead("Kalendari događaja", "Događaji iz ovih javnih kalendara (Google kalendar, iCal, .ics) automatski se dodaju u Događaje svako jutro. Promjene i otkazivanja u kalendaru prenose se sami.",
        h("button", { class: "btn", type: "button", onclick: () => calForm() }, "Dodaj kalendar")),
      list);
    const rows = await q(sb.from("kalendari").select("*").order("created_at"));
    if (!alive()) return;
    const counts = {};
    if (rows.length) (await q(sb.from("dogadaji").select("kalendar").in("kalendar", rows.map(r => r.id)).gte("pocetak", new Date().toISOString()))).forEach(d => { counts[d.kalendar] = (counts[d.kalendar] || 0) + 1; });
    if (!alive()) return;
    const importNow = (c, btn) => async () => {
      btn.disabled = true; btn.textContent = "Uvozim…";
      try {
        await q(sb.rpc("kalendar_uvezi", { p_id: c.id }));
        let r = { stanje: "ceka" };
        for (let i = 0; i < 10 && r.stanje === "ceka"; i++) { await new Promise(ok => setTimeout(ok, 2500)); r = await q(sb.rpc("kalendar_stanje", { p_id: c.id })); }
        if (r.stanje === "gotovo") toast(`Uvezeno: ${plural(r.broj || 0, "događaj", "događaja", "događaja")}`);
        else if (r.stanje === "ceka") toast("Kalendar se još učitava. Osvježi stranicu za minutu.");
        else toast(r.greska || "Uvoz nije uspio.");
      } catch (e) { toast(errText(e)); }
      refresh();
    };
    const toggle = c => async () => { try { await q(sb.from("kalendari").update({ aktivan: !c.aktivan }).eq("id", c.id)); refresh(); } catch (e) { toast(errText(e)); } };
    const remove = c => async () => {
      if (!confirm(`Ukloniti kalendar „${c.naziv}” i sve njegove događaje sa stranice?`)) return;
      try { await q(sb.from("kalendari").delete().eq("id", c.id)); toast("Kalendar je uklonjen"); refresh(); } catch (e) { toast(errText(e)); }
    };
    fill(list, rows.map(c => {
      const btn = h("button", { class: "btn small", type: "button" }, "Uvezi sada");
      btn.onclick = importNow(c, btn);
      return h("article", { class: "post" },
        h("div", { class: "meta" }, h("span", { class: "tag" }, c.aktivan ? "Uključen" : "Isključen"), h("span", {}, c.vrsta), h("span", {}, place(c)),
          h("span", {}, c.zadnji_uvoz ? "zadnji uvoz: " + date(c.zadnji_uvoz) : "još nije uvezen"),
          h("span", {}, "nadolazećih: " + (counts[c.id] || 0))),
        h("h3", {}, c.naziv),
        h("p", { class: "hint" }, c.url),
        c.greska ? h("p", { class: "err" }, c.greska) : null,
        h("div", { class: "actions" }, btn,
          h("button", { class: "btn small quiet", type: "button", onclick: () => calForm(c) }, "Uredi"),
          h("button", { class: "btn small quiet", type: "button", onclick: toggle(c) }, c.aktivan ? "Isključi" : "Uključi"),
          h("button", { class: "btn small quiet", type: "button", onclick: remove(c) }, "Ukloni")));
    }), emptyBox("Još nema kalendara", "Zamoli klub, festival ili bend za javnu adresu njihova kalendara u iCal obliku i dodaj je ovdje."));
  },

  /* ---------------- Pravila ---------------- */
  async privatnost() { legalPage(window.PRAVNO.privatnost); },
  async uvjeti() { legalPage(window.PRAVNO.uvjeti); },

  /* ---------------- Računi ---------------- */
  async prijava() {
    if (session) { go("/racun"); return; }
    authPage("Prijava", "Prijavi se da objavljuješ oglase, poslove i odgovore.", [
      { name: "email", label: "E-mail", type: "email", auto: "email" },
      { name: "lozinka", label: "Lozinka", type: "password", auto: "current-password" }],
      "Prijavi se", async v => {
        await q(sb.auth.signInWithPassword({ email: v.email, password: v.lozinka, options: { captchaToken: v.captcha || undefined } }));
        let back = "/"; try { back = sessionStorage.getItem("povratak") || back; sessionStorage.removeItem("povratak"); } catch {}
        go(back); toast("Prijavljen si");
      },
      [h("a", { href: "/zaboravljena-lozinka" }, "Zaboravio si lozinku?"), h("span", {}, "Nemaš račun? ", h("a", { href: "/registracija" }, "Registriraj se"))]);
  },

  async registracija() {
    if (session) { go("/racun"); return; }
    authPage("Registracija", "Besplatno. Ime koje upišeš vidjet će drugi uz tvoje objave. Poslat ćemo ti e-poruku za potvrdu računa, pa provjeri i neželjenu poštu.", [
      { name: "ime", label: "Ime ili nadimak", type: "text", auto: "nickname", max: 60 },
      { name: "email", label: "E-mail", type: "email", auto: "email" },
      { name: "lozinka", label: "Lozinka", type: "password", auto: "new-password", min: 8, hint: "Najmanje 8 znakova." }],
      "Registriraj se", async (v, ok) => {
        const data = await q(sb.auth.signUp({ email: v.email, password: v.lozinka, options: { data: { ime: v.ime }, emailRedirectTo: location.origin + "/", captchaToken: v.captcha || undefined } }));
        if (data.session) { go("/"); toast("Dobro došao na BisStage"); }
        else ok("Poslali smo ti e-poruku. Klikni poveznicu u njoj da potvrdiš račun, a zatim se prijavi. Ako poruku ne vidiš za nekoliko minuta, provjeri neželjenu poštu (Spam).");
      },
      [h("span", {}, "Već imaš račun? ", h("a", { href: "/prijava" }, "Prijavi se"))], true,
      h("label", { class: "check", for: "a-uvjeti" }, h("input", { id: "a-uvjeti", name: "uvjeti", type: "checkbox", required: true }),
        h("span", {}, "Imam najmanje 16 godina i prihvaćam ", h("a", { href: "/uvjeti", target: "_blank" }, "Uvjete korištenja"), " i ",
          h("a", { href: "/privatnost", target: "_blank" }, "Pravila privatnosti"), ".")));
  },

  async ["zaboravljena-lozinka"]() {
    authPage("Nova lozinka", "Upiši e-mail i poslat ćemo ti poveznicu za novu lozinku. Otvori je u istom pregledniku.", [
      { name: "email", label: "E-mail", type: "email", auto: "email" }],
      "Pošalji poveznicu", async (v, ok) => {
        await q(sb.auth.resetPasswordForEmail(v.email, { redirectTo: location.origin + "/?reset=1", captchaToken: v.captcha || undefined }));
        ok("Ako postoji račun s tom adresom, poslali smo ti poveznicu. Ako je ne vidiš, provjeri neželjenu poštu (Spam).");
      }, [h("a", { href: "/prijava" }, "Natrag na prijavu")], false);
  },

  async ["nova-lozinka"]() {
    if (!session) { authPage("Poveznica je istekla", "Zatraži novu poveznicu za promjenu lozinke.", [], null, null, [h("a", { class: "btn", href: "/zaboravljena-lozinka" }, "Zatraži novu poveznicu")], false); return; }
    authPage("Postavi novu lozinku", "Upiši novu lozinku za svoj račun.", [
      { name: "lozinka", label: "Nova lozinka", type: "password", auto: "new-password", min: 8, hint: "Najmanje 8 znakova." }],
      "Spremi lozinku", async () => {
        await q(sb.auth.updateUser({ password: $("a-lozinka").value }));
        go("/"); toast("Lozinka je promijenjena");
      }, [], false);
  },

  async korisnik(id, alive) {
    $("main").replaceChildren(loading());
    const [[p], og, po, te, ev] = await Promise.all([
      q(sb.from("profili").select("id,ime,slika,created_at").eq("id", id).limit(1)),
      q(activeAds(sb.from("oglasi").select(OGLAS_JAVNO)).eq("autor", id).order("created_at", { ascending: false }).limit(100)),
      q(sb.from("poslovi").select(POSAO_JAVNO).eq("autor", id).order("created_at", { ascending: false }).limit(100)),
      q(sb.from("teme_pregled").select("*").eq("autor", id).order("created_at", { ascending: false }).limit(100)),
      q(upcoming().eq("autor", id).limit(50)),
    ]);
    if (!alive()) return;
    if (!p) { $("main").replaceChildren(emptyBox("Ovaj korisnik više ne postoji", "Možda je izbrisao račun.")); return; }
    nameCache.set(p.id, p.ime); avatarCache.set(p.id, p.slika || null);
    setTitle(p.ime);
    const sec = (title, items, empty) => h("section", { class: "stack" }, h("h2", {}, title), items.length ? h("div", { class: "rows" }, items) : emptyBox(null, empty));
    $("main").replaceChildren(...[
      h("div", { class: "profile-head" }, avatar(p.id, "xl"), pageHead(p.ime, `Član od ${["siječnja","veljače","ožujka","travnja","svibnja","lipnja","srpnja","kolovoza","rujna","listopada","studenoga","prosinca"][new Date(p.created_at).getMonth()]} ${new Date(p.created_at).getFullYear()}. · ${plural(og.length, "oglas", "oglasa", "oglasa")} · ${plural(te.length, "tema", "teme", "tema")} na forumu`)),
      sec("Oglasi", featFirst(og).map(o => adRow(o, "a", "/oglas/" + o.id)), "Nema aktivnih oglasa."),
      po.length ? sec("Poslovi", po.map(o => jobRow(o, "a", "/posao/" + o.id)), "") : null,
      ev.length ? sec("Nadolazeći događaji", ev.map(eventRow), "") : null,
      sec("Teme na forumu", te.map(threadRow), "Još nije otvorio nijednu temu.")].filter(Boolean));
  },

  async racun(_, alive) {
    if (!session) { go("/prijava"); return; }
    const err = h("p", { class: "err", role: "alert" });
    const name = h("input", { id: "r-ime", required: true, maxlength: 60, value: me?.ime || "" });
    const save = h("button", { class: "btn", type: "submit" }, "Spremi ime");
    const notif = h("input", { id: "r-obavijesti", type: "checkbox", checked: true, disabled: true });
    notif.addEventListener("change", async () => {
      notif.disabled = true;
      try { await q(sb.from("postavke").upsert({ id: uid(), obavijesti_forum: notif.checked })); toast(notif.checked ? "Obavijesti su uključene" : "Obavijesti su isključene"); }
      catch (x) { notif.checked = !notif.checked; toast(errText(x)); }
      notif.disabled = false;
    });
    const notifS = h("input", { id: "r-pretrage", type: "checkbox", checked: true, disabled: true });
    notifS.addEventListener("change", async () => {
      notifS.disabled = true;
      try { await q(sb.from("postavke").upsert({ id: uid(), obavijesti_pretrage: notifS.checked })); toast(notifS.checked ? "Obavijesti su uključene" : "Obavijesti su isključene"); }
      catch (x) { notifS.checked = !notifS.checked; toast(errText(x)); }
      notifS.disabled = false;
    });
    const mine = h("div", { class: "rows" }, loading()), tabs = h("div", { class: "chips" });
    const settings = h("div", { class: "auth" },
      h("h1", {}, "Moj račun"),
      h("p", {}, session.user.email),
      h("form", { onsubmit: async e => {
        e.preventDefault(); save.disabled = true; err.textContent = "";
        try { await q(sb.from("profili").update({ ime: name.value.trim() }).eq("id", uid())); nameCache.delete(uid()); await loadMe(); renderAccount(); toast("Ime je spremljeno"); }
        catch (x) { err.textContent = errText(x); }
        save.disabled = false;
      } }, h("label", { class: "field", for: "r-ime" }, "Ime koje drugi vide", name), err, h("div", {}, save)),
      avatarEditor(),
      h("label", { class: "check", for: "r-obavijesti" }, notif, h("span", {}, "Pošalji mi e-poruku kad netko odgovori na moju temu na forumu")),
      h("label", { class: "check", for: "r-pretrage" }, notifS, h("span", {}, "Pošalji mi e-poruku kad se pojavi novi oglas za moje spremljene pretrage")),
      me?.admin ? h("p", {}, h("span", { class: "tag" }, "Administrator"), " Možeš brisati sve objave. ", h("a", { href: "/prijave" }, reportCount ? `Otvorene prijave: ${reportCount}` : "Pregled prijava"), " · ", h("a", { href: "/kalendari" }, "Kalendari događaja"), " · ", h("a", { href: "/statistika" }, "Statistika")) : null,
      h("div", { class: "actions" },
        h("a", { class: "btn quiet", href: "/korisnik/" + uid() }, "Moj javni profil"),
        h("a", { class: "btn quiet", href: "/zaboravljena-lozinka" }, "Promijeni lozinku"),
        h("button", { class: "btn danger", type: "button", onclick: async () => { await sb.auth.signOut(); go("/"); toast("Odjavljen si"); } }, "Odjavi se")),
      h("details", { class: "danger-zone" }, h("summary", {}, "Izbriši račun"),
        h("p", {}, "Brisanjem računa trajno se brišu tvoj profil, svi oglasi, poslovi, teme, odgovori, ocjene, fotografije, spremljeni oglasi i pretrage. To se ne može poništiti."),
        h("button", { class: "btn confirm", type: "button", onclick: deleteAccount }, "Izbriši moj račun")));
    $("main").replaceChildren(settings, h("section", { class: "stack my-posts" }, h("h2", {}, "Moje objave"), tabs, mine));

    const [pref, og, po, te, ev, sp, pr] = await Promise.all([
      q(sb.from("postavke").select("obavijesti_forum,obavijesti_pretrage").eq("id", uid()).limit(1)).catch(() => []),
      q(sb.from("oglasi").select(OGLAS_JAVNO + ",kontakt").eq("autor", uid()).order("created_at", { ascending: false })),
      q(sb.from("poslovi").select(POSAO_JAVNO + ",kontakt").eq("autor", uid()).order("created_at", { ascending: false })),
      q(sb.from("teme_pregled").select("*").eq("autor", uid()).order("created_at", { ascending: false })),
      q(sb.from("dogadaji").select("*").eq("autor", uid()).order("pocetak", { ascending: false })),
      q(sb.from("spremljeni").select("oglas").order("created_at", { ascending: false })).then(async r => r.length ? q(sb.from("oglasi").select(OGLAS_JAVNO + ",kontakt").in("id", r.map(x => x.oglas))) : []),
      q(sb.from("pretrage").select("*").order("created_at", { ascending: false })),
    ]);
    await loadNames(sp.map(o => o.autor));
    if (!alive()) return;
    notif.checked = pref[0]?.obavijesti_forum ?? true; notif.disabled = false;
    notifS.checked = pref[0]?.obavijesti_pretrage ?? true; notifS.disabled = false;
    const searchRow = p => h("div", { class: "row" }, h("h3", {}, [p.q && `„${p.q}”`, p.kategorija, p.drzava].filter(Boolean).join(" · ")),
      h("div", { class: "value" }, h("button", { class: "btn small danger", type: "button", onclick: async () => {
        try { await q(sb.from("pretrage").delete().eq("id", p.id)); pr.splice(pr.indexOf(p), 1); toast("Pretraga je izbrisana"); redraw(); } catch (x) { toast(errText(x)); }
      } }, "Izbriši")),
      h("div", { class: "meta" }, h("span", {}, "Spremljeno " + date(p.created_at)), p.zadnja_obavijest ? h("span", {}, "Zadnja obavijest " + date(p.zadnja_obavijest)) : null));
    const st = filters.mojeObjave;
    const lists = {
      oglasi: [`Oglasi (${og.length})`, () => og.map(o => expander("o" + o.id, adRow(o), adBody(o))), ["Još nemaš oglasa", "Objavi prvi oglas u Oglasniku."]],
      poslovi: [`Poslovi (${po.length})`, () => po.map(o => expander("p" + o.id, jobRow(o), jobBody(o))), ["Još nemaš poslova", "Objavi posao na Burzi poslova."]],
      teme: [`Teme (${te.length})`, () => te.map(threadRow), ["Još nemaš tema", "Otvori temu na Forumu."]],
      dogadaji: [`Događaji (${ev.length})`, () => ev.map(eventRow), ["Još nemaš događaja", "Dodaj koncert, tečaj ili jam session u Događajima."]],
      spremljeno: [`Spremljeno (${sp.length})`, () => sp.map(o => expander("s" + o.id, adRow(o), adBody(o))), ["Još nemaš spremljenih oglasa", "U oglasu klikni ♡ Spremi."]],
      pretrage: [`Pretrage (${pr.length})`, () => pr.map(searchRow), ["Još nemaš spremljenih pretraga", "U Oglasniku upiši što tražiš i klikni 🔔 Javi mi kad se pojavi novi oglas."]],
    };
    redraw = () => {
      tabs.replaceChildren(...Object.entries(lists).map(([k, [l]]) => h("button", { class: "chip", type: "button", "aria-pressed": String(st.tab === k), onclick: () => { st.tab = k; redraw(); } }, l)));
      const [, items, [et, ex]] = lists[st.tab];
      fill(mine, items(), emptyBox(et, ex));
    };
    redraw();
  },

};

async function squareAvatar(file) {
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch { throw new UserError("Tu sliku ne mogu otvoriti. Koristi JPG, PNG ili WebP."); }
  const side = Math.min(bmp.width, bmp.height), out = 320;
  const c = document.createElement("canvas"); c.width = c.height = out;
  c.getContext("2d").drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out);
  return new Promise(r => c.toBlob(r, "image/jpeg", 0.85));
}
function avatarEditor() {
  const input = h("input", { id: "r-slika", type: "file", accept: "image/jpeg,image/png,image/webp", hidden: true });
  const pic = h("span", { class: "avatar-slot" }, avatar(uid(), "lg"));
  const status = h("span", { class: "hint" });
  const setPath = async path => {
    const old = me.slika;
    await q(sb.from("profili").update({ slika: path }).eq("id", uid()));
    me.slika = path; avatarCache.set(uid(), path);
    pic.replaceChildren(avatar(uid(), "lg")); renderAccount(); remove.hidden = !path;
    if (old) await removeSlike([old]);
  };
  input.addEventListener("change", async () => {
    const f = input.files[0]; if (!f) return;
    status.textContent = "Spremam…";
    try {
      const blob = await squareAvatar(f);
      const path = `${uid()}/profil/${crypto.randomUUID()}.jpg`;
      await q(sb.storage.from("slike").upload(path, blob, { contentType: "image/jpeg", upsert: false }));
      await setPath(path); toast("Profilna slika je spremljena");
    } catch (e) { toast(errText(e)); }
    status.textContent = ""; input.value = "";
  });
  const remove = h("button", { class: "btn small quiet", type: "button", hidden: !me?.slika, onclick: async () => {
    try { await setPath(null); toast("Profilna slika je uklonjena"); } catch (e) { toast(errText(e)); }
  } }, "Ukloni");
  return h("div", { class: "avatar-edit" }, pic, h("div", { class: "stack-sm" },
    h("strong", {}, "Profilna slika"),
    h("div", { class: "actions" }, h("label", { class: "btn small", for: "r-slika" }, "Odaberi sliku"), remove, input),
    status, h("span", { class: "hint" }, "Slika se izreže u kvadrat. Vidljiva je svima uz tvoje ime.")));
}

function deleteAccount() {
  openForm({ title: "Izbriši račun", submit: "Trajno izbriši račun", done: "Račun je izbrisan",
    fields: [{ name: "potvrda", label: "Za potvrdu upiši IZBRIŠI", required: true, max: 20, hint: "Brišu se profil, sve objave, ocjene i fotografije. To se ne može poništiti." }],
    save: async v => {
      if (v.potvrda.toUpperCase() !== "IZBRIŠI") throw new UserError("Upiši točno riječ IZBRIŠI.");
      const [og, op, ev] = await Promise.all([
        q(sb.from("oglasi").select("slike").eq("autor", uid())),
        q(sb.from("oprema").select("slika").eq("autor", uid())),
        q(sb.from("dogadaji").select("plakat").eq("autor", uid())),
      ]);
      const paths = [...og.flatMap(o => o.slike || []), ...op.map(o => o.slika), ...ev.map(e => e.plakat), me?.slika].filter(Boolean);
      for (let i = 0; i < paths.length; i += 100) await removeSlike(paths.slice(i, i + 100));
      await q(sb.rpc("obrisi_racun"));
      await sb.auth.signOut();
      go("/");
    } });
}

function legalPage(d) {
  const mail = t => {
    const parts = String(t).split("kontakt@bisstage.com");
    return parts.flatMap((x, i) => i ? [h("a", { href: "mailto:kontakt@bisstage.com" }, "kontakt@bisstage.com"), x] : [x]);
  };
  const block = x => Array.isArray(x) ? h("ul", {}, x.map(li => h("li", {}, mail(li)))) : h("p", {}, mail(x));
  $("main").replaceChildren(h("article", { class: "doc" },
    h("h1", {}, d.naslov), h("p", { class: "updated" }, "Posljednja izmjena: " + d.azurirano), h("p", {}, d.uvod),
    d.odjeljci.flatMap(([title, ...rest]) => [h("h2", {}, title), ...rest.map(block)])));
}

let tsLoad = null;
function loadTurnstile() {
  return tsLoad ||= new Promise((res, rej) => {
    const sc = document.createElement("script");
    sc.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    sc.async = true; sc.onload = () => res(window.turnstile); sc.onerror = () => { tsLoad = null; rej(new Error("Failed to fetch")); };
    document.head.append(sc);
  });
}

function authPage(title, text, fields, submitLabel, run, links = [], google = true, extra = null) {
  const err = h("p", { class: "err", role: "alert" });
  // Nevidljiva provjera protiv botova (Cloudflare Turnstile), kad je ključ upisan u config.js.
  const cap = CFG.turnstileKljuc && run && fields.some(f => f.name === "email") ? { box: h("div", { class: "captcha" }), token: null, id: null } : null;
  if (cap) loadTurnstile().then(ts => {
    if (!cap.box.isConnected) return;
    cap.id = ts.render(cap.box, { sitekey: CFG.turnstileKljuc, size: "flexible", appearance: "interaction-only", language: "hr",
      callback: t => { cap.token = t; }, "expired-callback": () => { cap.token = null; }, "error-callback": () => { cap.token = null; } });
  }).catch(() => { err.textContent = "Sigurnosna provjera se nije učitala. Osvježi stranicu."; });
  const ok = h("p", { class: "ok", role: "status" });
  const send = submitLabel ? h("button", { class: "btn", type: "submit" }, submitLabel) : null;
  const inputs = fields.map(f => h("label", { class: "field", for: "a-" + f.name }, f.label,
    h("input", { id: "a-" + f.name, name: f.name, type: f.type, autocomplete: f.auto, required: true, minlength: f.min, maxlength: f.max }),
    f.hint ? h("span", { class: "hint" }, f.hint) : null));
  const form = run ? h("form", { onsubmit: async e => {
    e.preventDefault(); send.disabled = true; err.textContent = ""; ok.textContent = "";
    const v = Object.fromEntries([...new FormData(form).entries()].filter(([k]) => !k.startsWith("cf-")).map(([k, x]) => [k, k === "lozinka" ? x : String(x).trim()]));
    if (cap) {
      v.captcha = cap.token || (cap.id != null && window.turnstile?.getResponse(cap.id)) || null;
      if (!v.captcha) { err.textContent = "Sigurnosna provjera još traje. Pričekaj trenutak i pokušaj ponovo."; send.disabled = false; return; }
    }
    try { await run(v, m => { ok.textContent = m; form.reset(); }); }
    catch (x) { console.error(x); err.textContent = errText(x); }
    if (cap && cap.id != null) { try { window.turnstile.reset(cap.id); } catch {} cap.token = null; }
    send.disabled = false;
  } }, inputs, extra, cap?.box, err, ok, h("div", {}, send)) : null;
  const g = google && CFG.googlePrijava ? [h("button", { class: "btn google", type: "button", onclick: async () => {
    const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + "/" } });
    if (error) err.textContent = errText(error);
  } }, "Nastavi s Google računom"),
    h("p", { class: "hint" }, "Nastavkom s Google računom potvrđuješ da imaš najmanje 16 godina i prihvaćaš ", h("a", { href: "/uvjeti", target: "_blank" }, "Uvjete korištenja"), " i ",
      h("a", { href: "/privatnost", target: "_blank" }, "Pravila privatnosti"), "."),
    h("div", { class: "or" }, "ili")] : [];
  $("main").replaceChildren(h("div", { class: "auth" }, h("h1", {}, title), h("p", {}, text), ...g, form, h("div", { class: "actions" }, links)));
}

/* ------------------------------------------------------------------ */
/* Usmjeravanje i pokretanje                                           */
/* ------------------------------------------------------------------ */
const NAV_OF = { dogadaj: "dogadaji", tema: "forum", oprema: "ocjene", oglas: "oglasi", posao: "poslovi", prijava: "account", registracija: "account", racun: "account", prijave: "account", kalendari: "dogadaji", statistika: "account" };

const TITLE = "BisStage – oglasnik instrumenata, poslovi za glazbenike i forum";
function setTitle(t) { document.title = t ? `${t} – BisStage` : TITLE; }

function go(path) {
  if (path !== location.pathname) history.pushState(null, "", path);
  route();
}

// Stare adrese s # (npr. #oglas-<id>, #forum) prebacuju se na prave putanje.
function legacyHash() {
  const h = location.hash.slice(1);
  if (!h) return null;
  const m = h.match(/^(tema|oprema|oglas|posao|dogadaj)-([0-9a-f-]{36})$/);
  if (m) return `/${m[1]}/${m[2]}`;
  if (h === "pocetna") return "/";
  return views[h] ? "/" + h : null;
}

async function route(keepScroll) {
  const token = ++navToken;
  const alive = () => token === navToken;
  const raw = location.pathname.replace(/^\/+|\/+$/g, "") || "pocetna";
  const m = raw.match(/^(tema|oprema|oglas|posao|korisnik|dogadaj)\/([0-9a-f-]{36})$/);
  const name = m ? m[1] : views[raw] ? raw : "pocetna";
  redraw = () => {};
  if (!keepScroll) open.clear(); // prelaskom na drugi dio stranice otvoreni oglasi se zatvaraju
  setTitle(null);
  if (name !== "pocetna") $("hero").replaceChildren();
  const navName = NAV_OF[name] || name;
  document.querySelectorAll("#nav a").forEach(a => a.getAttribute("href") === "/" + navName ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  navName === "account" ? $("account").setAttribute("aria-current", "page") : $("account").removeAttribute("aria-current");
  const y = window.scrollY;
  try { await views[name](m && m[2], alive); }
  catch (e) {
    console.error(e);
    if (alive()) $("main").replaceChildren(emptyBox("Stranica se nije učitala", errText(e)));
  }
  if (alive()) window.scrollTo(0, keepScroll ? y : 0);
}
function refresh() { route(true); }

const savedAds = new Set();
async function loadSaved() {
  savedAds.clear();
  if (!session) return;
  const rows = await q(sb.from("spremljeni").select("oglas")).catch(() => []);
  rows.forEach(r => savedAds.add(r.oglas));
}
async function loadMe() {
  if (!session) { me = null; savedAds.clear(); return; }
  await loadSaved();
  const rows = await q(sb.from("profili").select("id,ime,admin,slika").eq("id", session.user.id).limit(1)).catch(() => []);
  me = rows[0] || { id: session.user.id, ime: "Član", admin: false, slika: null };
  nameCache.set(me.id, me.ime); avatarCache.set(me.id, me.slika || null);
}
let reportCount = 0;
async function updateReportCount() {
  if (!me?.admin) { reportCount = 0; return; }
  const { count } = await sb.from("prijave").select("id", { count: "exact", head: true }).eq("rijeseno", false);
  reportCount = count || 0;
  renderAccount();
}
function renderAccount() {
  const a = $("account");
  if (session) { a.replaceChildren(me ? avatar(me.id) : "", (me?.ime || "Moj račun") + (reportCount ? " · " + plural(reportCount, "prijava", "prijave", "prijava") : "")); a.href = reportCount ? "/prijave" : "/racun"; }
  else { a.textContent = "Prijava"; a.href = "/prijava"; }
}

async function boot() {
  if (!window.supabase?.createClient || !CFG.supabaseUrl) {
    $("main").replaceChildren(emptyBox("Stranica se nije učitala", "Provjeri internet i osvježi stranicu."));
    return;
  }
  sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } });
  const params = new URLSearchParams(location.search);
  const { data } = await sb.auth.getSession();
  session = data.session;
  const legacy = legacyHash();
  if (params.get("reset")) history.replaceState(null, "", "/nova-lozinka");
  else if (legacy) history.replaceState(null, "", legacy);
  else if (location.search || location.hash) history.replaceState(null, "", location.pathname);
  if (params.get("error_description")) toast("Poveznica nije valjana ili je istekla. Zatraži novu.");
  await loadMe();
  renderAccount();
  updateReportCount().catch(() => {});
  sb.auth.onAuthStateChange((event, s) => {
    if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") { session = s; return; }
    setTimeout(async () => {
      session = s; qCache.clear();
      await loadMe();
      renderAccount();
      updateReportCount().catch(() => {});
      if (event === "PASSWORD_RECOVERY") { go("/nova-lozinka"); return; }
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") refresh();
    }, 0);
  });
  addEventListener("popstate", () => route());
  let installEvt = null;
  addEventListener("beforeinstallprompt", e => {
    e.preventDefault(); installEvt = e;
    const b = $("install"); if (b) b.hidden = false;
  });
  $("install")?.addEventListener("click", async () => {
    if (!installEvt) return;
    installEvt.prompt();
    const { outcome } = await installEvt.userChoice.catch(() => ({}));
    if (outcome === "accepted") { $("install").hidden = true; toast("BisStage je dodan na početni zaslon"); }
    installEvt = null;
  });
  addEventListener("appinstalled", () => { const b = $("install"); if (b) b.hidden = true; });
  addEventListener("hashchange", () => { const l = legacyHash(); if (l) { history.replaceState(null, "", l); route(); } });
  document.addEventListener("click", e => {
    const a = e.target.closest("a[href]");
    if (!a || a.target === "_blank" || a.hasAttribute("download") || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin || /\.[a-z0-9]+$/i.test(u.pathname)) return;
    e.preventDefault();
    if (a.closest("dialog")) a.closest("dialog").close();
    go(u.pathname);
  });
  route();
}
boot();
