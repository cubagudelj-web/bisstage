"use strict";

/* ------------------------------------------------------------------ */
/* Postavke i popisi (moraju odgovarati provjerama u schema.sql)       */
/* ------------------------------------------------------------------ */
const CFG = window.BISSTAGE || {};
const COUNTRIES = ["Hrvatska", "Slovenija", "Bosna i Hercegovina", "Srbija", "Crna Gora", "Sjeverna Makedonija"];
const CATS = ["Gitare i basovi", "Bubnjevi i udaraljke", "Klavijature", "Gudački", "Puhački", "Tamburice", "Ozvučenje", "Kućni studio"];
const CONDS = ["Novo", "Kao novo", "Korišteno", "Za popravak"];
const CURS = { EUR: "€", KM: "KM", RSD: "RSD", MKD: "MKD" };
const JOBS = ["Svirka", "Stalni angažman", "Studijsko snimanje", "Poduka", "Bend traži člana"];
const TOPICS = ["Instrumenti", "Bendovi i svirke", "Kućni studio", "Učenje i poduka", "Razgovor"];
const CRIT = [["zvuk", "Zvuk"], ["izrada", "Izrada"], ["vrijednost", "Vrijednost"]];
const MAX_SLIKA = 4;
const LIMIT = 300;

const OGLAS_JAVNO = "id,autor,naslov,kategorija,stanje,cijena,valuta,grad,drzava,opis,slike,video,istaknut_od,istaknut_do,created_at";
const POSAO_JAVNO = "id,autor,naslov,vrsta,honorar,grad,drzava,rok,opis,istaknut_od,istaknut_do,created_at";

/* ------------------------------------------------------------------ */
/* Stanje                                                              */
/* ------------------------------------------------------------------ */
let sb = null;
let session = null;
let me = null; // { id, ime, admin }
let navToken = 0;
const filters = { prijave: { tab: "otvorene" }, mojeObjave: { tab: "oglasi" }, oglasi: { q: "", cat: "", drzava: "" }, poslovi: { q: "", vrsta: "", drzava: "" }, forum: { q: "", kat: "" }, ocjene: { q: "", kat: "" } };
const open = new Set();
const nameCache = new Map();

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

async function q(promise) {
  const { data, error } = await promise;
  if (error) throw error;
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
  return "Nešto nije uspjelo. Pokušaj ponovo.";
}

function toast(text) {
  const t = $("toast");
  t.textContent = text; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2800);
}

async function loadNames(ids) {
  const need = [...new Set(ids)].filter(i => i && !nameCache.has(i));
  for (let i = 0; i < need.length; i += 80) {
    const rows = await q(sb.from("profili").select("id,ime").in("id", need.slice(i, i + 80)));
    rows.forEach(r => nameCache.set(r.id, r.ime));
  }
}
const nameOf = id => nameCache.get(id) || "Član";
const authorLink = id => h("a", { class: "author", href: "/korisnik/" + id }, nameOf(id));

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
      f.options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h("option", { value: v, selected: String(values[f.name] ?? "") === String(v) }, l); }));
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
  if (files.length > MAX_SLIKA) throw new UserError(`Možeš dodati najviše ${MAX_SLIKA} fotografije.`);
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
async function withFeatured(tbl, cols, rows) {
  const feat = await q(sb.from(tbl).select(cols).gt("istaknut_do", new Date().toISOString()).order("istaknut_od", { ascending: false }).limit(50));
  const ids = new Set(rows.map(r => r.id));
  return featFirst([...feat.filter(f => !ids.has(f.id)), ...rows]);
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
  h("div", { class: "meta" }, featTag(o), o.video ? h("span", { class: "tag" }, "▶ video") : null, h("span", {}, o.kategorija), h("span", {}, o.stanje), h("span", {}, place(o)), h("span", {}, nameOf(o.autor)), h("span", {}, date(o.created_at))));
const jobRow = (o, tag = "summary", href) => h(tag, { class: "row" + (featured(o) ? " featured" : ""), href }, h("h3", {}, o.naslov),
  h("div", { class: "value" }, o.honorar || "Po dogovoru"),
  h("div", { class: "meta" }, featTag(o), h("span", {}, o.vrsta), h("span", {}, place(o)), o.rok ? h("span", {}, "Rok: " + day(o.rok)) : null, h("span", {}, nameOf(o.autor)), h("span", {}, date(o.created_at))));
const threadRow = t => h("a", { class: "row", href: "/tema/" + t.id }, h("h3", {}, t.naslov),
  h("div", { class: "value" }, String(t.broj_odgovora ?? 0), h("small", {}, "odg.")),
  h("div", { class: "meta" }, h("span", {}, t.kategorija), h("span", {}, nameOf(t.autor)), h("span", {}, date(t.created_at))));
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
    h("p", {}, o.opis), h("p", { class: "by" }, "Objavio: ", authorLink(o.autor)), contact(o),
    h("div", { class: "actions" },
      ...featureBtns("oglasi", o),
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
      h("div", {}, h("h1", {}, "BisStage"), h("p", { class: "lead" }, "Kupi i prodaj instrumente, nađi svirku, pitaj kolege i ocijeni opremu. Za glazbenike iz Hrvatske i regije.")),
      h("nav", { class: "staff", "aria-label": "Dijelovi stranice" },
        door("oglasi", "Oglasnik", 5.5, 2.5, "low", "oglasi"), door("poslovi", "Burza poslova", 4.5, 1.5, "", "poslovi"),
        door("forum", "Forum", 3.5, .5, "", "teme"), door("ocjene", "Ocjene opreme", 2, 2, "down", "oprema")))));
    bandFx(fx);
    const box = (title, href, cls = "rows") => { const list = h("div", { class: cls }, loading()); return [list, h("section", {}, h("h2", {}, title, h("a", { href: "/" + href }, "Sve")), list)]; };
    const [a, as] = box("Novi oglasi", "oglasi"), [j, js] = box("Novi poslovi", "poslovi"), [t, ts] = box("Na forumu", "forum"), [g, gs] = box("Najbolje ocijenjeno", "ocjene", "stack");
    const featList = h("div", { class: "feat-grid" });
    const featSec = h("section", { class: "feat-sec", hidden: true }, h("h2", {}, "Istaknuti oglasi", h("a", { href: "/oglasi" }, "Svi oglasi")), featList);
    $("main").replaceChildren(featSec, h("div", { class: "home" }, as, js, ts, gs));

    const newest = (tbl, cols, n = 3) => q(sb.from(tbl).select(cols).order("created_at", { ascending: false }).limit(n));
    const count = tbl => sb.from(tbl).select("id", { count: "exact", head: true }).then(r => r.count ?? "–");
    const [og, po, te, ft, op, ...counts] = await Promise.all([
      newest("oglasi", OGLAS_JAVNO), newest("poslovi", POSAO_JAVNO), newest("teme_pregled", "*"),
      q(sb.from("oglasi").select(OGLAS_JAVNO).gt("istaknut_do", new Date().toISOString()).order("istaknut_od", { ascending: false }).limit(4)),
      q(sb.from("oprema_pregled").select("*").gt("broj_ocjena", 0).order("prosjek", { ascending: false }).limit(2)),
      count("oglasi"), count("poslovi"), count("teme"), count("oprema"),
    ]);
    await loadNames([...og, ...po, ...te, ...ft].map(x => x.autor));
    if (!alive()) return;
    ["oglasi", "poslovi", "teme", "oprema"].forEach((k, i) => { const el = document.querySelector(`[data-c="${k}"]`); if (el) el.textContent = counts[i]; });
    featSec.hidden = !ft.length;
    featList.replaceChildren(...ft.map(o => h("a", { class: "feat-card", href: "/oglas/" + o.id },
      o.slike?.length ? h("img", { src: imgUrl(o.slike[0]), alt: "", loading: "lazy" }) : h("span", { class: "feat-ph", "aria-hidden": "true" }, "♪"),
      h("span", { class: "tag feat" }, "Istaknuto"), h("strong", {}, o.naslov), h("span", { class: "value" }, price(o)), h("span", { class: "meta" }, place(o)))));
    fill(a, og.map(o => adRow(o, "a", "/oglas/" + o.id)), emptyBox("Još nema oglasa", "Objavi prvi oglas u Oglasniku."));
    fill(j, po.map(o => jobRow(o, "a", "/posao/" + o.id)), emptyBox("Još nema poslova", "Objavi prvi posao na Burzi poslova."));
    fill(t, te.map(threadRow), emptyBox("Još nema tema", "Otvori prvu temu na Forumu."));
    fill(g, op.map(gearCard), emptyBox("Još nema ocjena", "Dodaj opremu u Ocjenama opreme."));
  },

  async oglasi(_, alive) {
    const st = filters.oglasi, list = h("div", { class: "rows" }, loading());
    $("main").replaceChildren(
      pageHead("Oglasnik", "Instrumenti i oprema, novi i rabljeni.", h("button", { class: "btn", type: "button", onclick: () => oglasForm() }, "Objavi oglas")),
      h("div", { class: "tools" }, search("q-oglasi", "Pretraži", st, "npr. tambura, Split"), pick("c-oglasi", "Kategorija", st, "cat", CATS), pick("d-oglasi", "Država", st, "drzava", COUNTRIES)),
      list);
    const cols = session ? OGLAS_JAVNO + ",kontakt" : OGLAS_JAVNO;
    const rows = await withFeatured("oglasi", cols, await q(sb.from("oglasi").select(cols).order("created_at", { ascending: false }).limit(LIMIT)));
    await loadNames(rows.map(r => r.autor));
    if (!alive()) return;
    redraw = () => fill(list, rows.filter(o => (!st.cat || o.kategorija === st.cat) && (!st.drzava || o.drzava === st.drzava) && hit(st.q, o.naslov, o.opis, o.grad))
      .map(o => expander("o" + o.id, adRow(o), adBody(o))), rows.length ? emptyBox("Nema takvih oglasa", "Promijeni pretragu ili filtre.") : emptyBox("Još nema oglasa", "Objavi prvi oglas."));
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
    const st = filters.forum, list = h("div", { class: "rows" }, loading()), chips = h("div", { class: "chips" });
    const newTopic = () => {
      if (needLogin()) return;
      openForm({ title: "Nova tema", submit: "Otvori temu",
        fields: [{ name: "naslov", label: "Naslov", required: true, max: 120, min_len: 3 }, { name: "kategorija", label: "Kategorija", options: TOPICS, required: true }, { name: "tekst", label: "Tekst", type: "textarea", required: true, max: 5000 }],
        save: v => q(sb.from("teme").insert({ naslov: v.naslov, kategorija: v.kategorija, tekst: v.tekst })) });
    };
    $("main").replaceChildren(pageHead("Forum", "Pitanja, savjeti i razgovori među glazbenicima.", h("button", { class: "btn", type: "button", onclick: newTopic }, "Otvori temu")),
      h("div", { class: "tools one" }, search("q-forum", "Pretraži teme", st, "npr. ozvučenje, svadba"), h("span")), chips, list);
    const rows = await q(sb.from("teme_pregled").select("*").order("created_at", { ascending: false }).limit(LIMIT));
    await loadNames(rows.map(r => r.autor));
    if (!alive()) return;
    redraw = () => {
      chips.replaceChildren(...["", ...TOPICS].map(k => h("button", { class: "chip", type: "button", "aria-pressed": String(st.kat === k), onclick: () => { st.kat = k; redraw(); } }, k || "Sve teme")));
      fill(list, rows.filter(t => (!st.kat || t.kategorija === st.kat) && hit(st.q, t.naslov, t.tekst)).map(threadRow),
        rows.length ? emptyBox("Nema takvih tema", "Promijeni pretragu ili kategoriju, ili otvori novu temu.") : emptyBox("Još nema tema", "Otvori prvu temu."));
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
    box.replaceChildren(metaHead(t.naslov, [h("span", {}, t.kategorija), authorLink(t.autor), h("span", {}, date(t.created_at))]),
      h("article", { class: "post" }, h("p", { class: "prose" }, t.tekst), h("div", { class: "actions" }, delBtn(t, async () => { await q(sb.from("teme").delete().eq("id", t.id)); go("/forum"); }), reportBtn("tema", t, "/tema/" + t.id, t.naslov))));
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
        await q(sb.auth.signInWithPassword({ email: v.email, password: v.lozinka }));
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
        const data = await q(sb.auth.signUp({ email: v.email, password: v.lozinka, options: { data: { ime: v.ime }, emailRedirectTo: location.origin + "/" } }));
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
        await q(sb.auth.resetPasswordForEmail(v.email, { redirectTo: location.origin + "/?reset=1" }));
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
    const [[p], og, po, te] = await Promise.all([
      q(sb.from("profili").select("id,ime,created_at").eq("id", id).limit(1)),
      q(sb.from("oglasi").select(OGLAS_JAVNO).eq("autor", id).order("created_at", { ascending: false }).limit(100)),
      q(sb.from("poslovi").select(POSAO_JAVNO).eq("autor", id).order("created_at", { ascending: false }).limit(100)),
      q(sb.from("teme_pregled").select("*").eq("autor", id).order("created_at", { ascending: false }).limit(100)),
    ]);
    if (!alive()) return;
    if (!p) { $("main").replaceChildren(emptyBox("Ovaj korisnik više ne postoji", "Možda je izbrisao račun.")); return; }
    nameCache.set(p.id, p.ime);
    setTitle(p.ime);
    const sec = (title, items, empty) => h("section", { class: "stack" }, h("h2", {}, title), items.length ? h("div", { class: "rows" }, items) : emptyBox(null, empty));
    $("main").replaceChildren(
      pageHead(p.ime, `Član od ${["siječnja","veljače","ožujka","travnja","svibnja","lipnja","srpnja","kolovoza","rujna","listopada","studenoga","prosinca"][new Date(p.created_at).getMonth()]} ${new Date(p.created_at).getFullYear()}. · ${plural(og.length, "oglas", "oglasa", "oglasa")} · ${plural(te.length, "tema", "teme", "tema")} na forumu`),
      sec("Oglasi", featFirst(og).map(o => adRow(o, "a", "/oglas/" + o.id)), "Nema aktivnih oglasa."),
      po.length ? sec("Poslovi", po.map(o => jobRow(o, "a", "/posao/" + o.id)), "") : null,
      sec("Teme na forumu", te.map(threadRow), "Još nije otvorio nijednu temu."));
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
      h("label", { class: "check", for: "r-obavijesti" }, notif, h("span", {}, "Pošalji mi e-poruku kad netko odgovori na moju temu na forumu")),
      me?.admin ? h("p", {}, h("span", { class: "tag" }, "Administrator"), " Možeš brisati sve objave. ", h("a", { href: "/prijave" }, reportCount ? `Otvorene prijave: ${reportCount}` : "Pregled prijava")) : null,
      h("div", { class: "actions" },
        h("a", { class: "btn quiet", href: "/korisnik/" + uid() }, "Moj javni profil"),
        h("a", { class: "btn quiet", href: "/zaboravljena-lozinka" }, "Promijeni lozinku"),
        h("button", { class: "btn danger", type: "button", onclick: async () => { await sb.auth.signOut(); go("/"); toast("Odjavljen si"); } }, "Odjavi se")),
      h("details", { class: "danger-zone" }, h("summary", {}, "Izbriši račun"),
        h("p", {}, "Brisanjem računa trajno se brišu tvoj profil, svi oglasi, poslovi, teme, odgovori, ocjene i fotografije. To se ne može poništiti."),
        h("button", { class: "btn confirm", type: "button", onclick: deleteAccount }, "Izbriši moj račun")));
    $("main").replaceChildren(settings, h("section", { class: "stack my-posts" }, h("h2", {}, "Moje objave"), tabs, mine));

    const [pref, og, po, te] = await Promise.all([
      q(sb.from("postavke").select("obavijesti_forum").eq("id", uid()).limit(1)).catch(() => []),
      q(sb.from("oglasi").select(OGLAS_JAVNO + ",kontakt").eq("autor", uid()).order("created_at", { ascending: false })),
      q(sb.from("poslovi").select(POSAO_JAVNO + ",kontakt").eq("autor", uid()).order("created_at", { ascending: false })),
      q(sb.from("teme_pregled").select("*").eq("autor", uid()).order("created_at", { ascending: false })),
    ]);
    if (!alive()) return;
    notif.checked = pref[0]?.obavijesti_forum ?? true; notif.disabled = false;
    const st = filters.mojeObjave;
    const lists = {
      oglasi: [`Oglasi (${og.length})`, () => og.map(o => expander("o" + o.id, adRow(o), adBody(o))), ["Još nemaš oglasa", "Objavi prvi oglas u Oglasniku."]],
      poslovi: [`Poslovi (${po.length})`, () => po.map(o => expander("p" + o.id, jobRow(o), jobBody(o))), ["Još nemaš poslova", "Objavi posao na Burzi poslova."]],
      teme: [`Teme (${te.length})`, () => te.map(threadRow), ["Još nemaš tema", "Otvori temu na Forumu."]],
    };
    redraw = () => {
      tabs.replaceChildren(...Object.entries(lists).map(([k, [l]]) => h("button", { class: "chip", type: "button", "aria-pressed": String(st.tab === k), onclick: () => { st.tab = k; redraw(); } }, l)));
      const [, items, [et, ex]] = lists[st.tab];
      fill(mine, items(), emptyBox(et, ex));
    };
    redraw();
  },

};

function deleteAccount() {
  openForm({ title: "Izbriši račun", submit: "Trajno izbriši račun", done: "Račun je izbrisan",
    fields: [{ name: "potvrda", label: "Za potvrdu upiši IZBRIŠI", required: true, max: 20, hint: "Brišu se profil, sve objave, ocjene i fotografije. To se ne može poništiti." }],
    save: async v => {
      if (v.potvrda.toUpperCase() !== "IZBRIŠI") throw new UserError("Upiši točno riječ IZBRIŠI.");
      const [og, op] = await Promise.all([
        q(sb.from("oglasi").select("slike").eq("autor", uid())),
        q(sb.from("oprema").select("slika").eq("autor", uid())),
      ]);
      const paths = [...og.flatMap(o => o.slike || []), ...op.map(o => o.slika).filter(Boolean)];
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

function authPage(title, text, fields, submitLabel, run, links = [], google = true, extra = null) {
  const err = h("p", { class: "err", role: "alert" });
  const ok = h("p", { class: "ok", role: "status" });
  const send = submitLabel ? h("button", { class: "btn", type: "submit" }, submitLabel) : null;
  const inputs = fields.map(f => h("label", { class: "field", for: "a-" + f.name }, f.label,
    h("input", { id: "a-" + f.name, name: f.name, type: f.type, autocomplete: f.auto, required: true, minlength: f.min, maxlength: f.max }),
    f.hint ? h("span", { class: "hint" }, f.hint) : null));
  const form = run ? h("form", { onsubmit: async e => {
    e.preventDefault(); send.disabled = true; err.textContent = ""; ok.textContent = "";
    const v = Object.fromEntries([...new FormData(form).entries()].map(([k, x]) => [k, k === "lozinka" ? x : String(x).trim()]));
    try { await run(v, m => { ok.textContent = m; form.reset(); }); }
    catch (x) { console.error(x); err.textContent = errText(x); }
    send.disabled = false;
  } }, inputs, extra, err, ok, h("div", {}, send)) : null;
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
const NAV_OF = { tema: "forum", oprema: "ocjene", oglas: "oglasi", posao: "poslovi", prijava: "account", registracija: "account", racun: "account", prijave: "account" };

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
  const m = h.match(/^(tema|oprema|oglas|posao)-([0-9a-f-]{36})$/);
  if (m) return `/${m[1]}/${m[2]}`;
  if (h === "pocetna") return "/";
  return views[h] ? "/" + h : null;
}

async function route(keepScroll) {
  const token = ++navToken;
  const alive = () => token === navToken;
  const raw = location.pathname.replace(/^\/+|\/+$/g, "") || "pocetna";
  const m = raw.match(/^(tema|oprema|oglas|posao|korisnik)\/([0-9a-f-]{36})$/);
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

async function loadMe() {
  if (!session) { me = null; return; }
  const rows = await q(sb.from("profili").select("id,ime,admin").eq("id", session.user.id).limit(1)).catch(() => []);
  me = rows[0] || { id: session.user.id, ime: "Član", admin: false };
  nameCache.set(me.id, me.ime);
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
  if (session) { a.textContent = (me?.ime || "Moj račun") + (reportCount ? " · " + plural(reportCount, "prijava", "prijave", "prijava") : ""); a.href = reportCount ? "/prijave" : "/racun"; }
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
      session = s;
      await loadMe();
      renderAccount();
      updateReportCount().catch(() => {});
      if (event === "PASSWORD_RECOVERY") { go("/nova-lozinka"); return; }
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") refresh();
    }, 0);
  });
  addEventListener("popstate", () => route());
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
