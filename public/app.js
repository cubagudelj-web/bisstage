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

const OGLAS_JAVNO = "id,autor,naslov,kategorija,stanje,cijena,valuta,grad,drzava,opis,slike,created_at";
const POSAO_JAVNO = "id,autor,naslov,vrsta,honorar,grad,drzava,rok,opis,created_at";

/* ------------------------------------------------------------------ */
/* Stanje                                                              */
/* ------------------------------------------------------------------ */
let sb = null;
let session = null;
let me = null; // { id, ime, admin }
let navToken = 0;
const filters = { oglasi: { q: "", cat: "", drzava: "" }, poslovi: { q: "", vrsta: "", drzava: "" }, forum: { kat: "" }, ocjene: { q: "", kat: "" } };
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

function needLogin() {
  if (session) return false;
  try { sessionStorage.setItem("povratak", location.hash || "#pocetna"); } catch {}
  location.hash = "#prijava";
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
    if (f.type === "file") return h("input", { id, name: f.name, type: "file", accept: "image/jpeg,image/png,image/webp", multiple: true });
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
async function removeSlike(paths) {
  if (paths?.length) { const { error } = await sb.storage.from("slike").remove(paths); if (error) console.warn(error); }
}

const oglasFields = edit => [
  { name: "naslov", label: "Što prodaješ", required: true, max: 90, min_len: 3 },
  [{ name: "kategorija", label: "Kategorija", options: CATS, required: true }, { name: "stanje", label: "Stanje", options: CONDS, required: true }],
  [{ name: "cijena", label: "Cijena", type: "number", min: 0, step: "any", hint: "Ostavi prazno za dogovor." }, { name: "valuta", label: "Valuta", options: Object.keys(CURS).map(k => [k, CURS[k]]) }],
  [{ name: "grad", label: "Grad", required: true, max: 60 }, { name: "drzava", label: "Država", options: COUNTRIES, required: true }],
  { name: "opis", label: "Opis", type: "textarea", required: true },
  { name: "kontakt", label: "Kontakt", required: true, min_len: 3, hint: "Telefon ili e-mail. Vide ga samo prijavljeni korisnici." },
  { name: "slike", label: `Fotografije (najviše ${MAX_SLIKA})`, type: "file", hint: edit ? "Ako odabereš nove, zamijenit će postojeće." : "JPG, PNG ili WebP. Smanjit ćemo ih prije slanja." },
];
function oglasForm(existing) {
  if (needLogin()) return;
  openForm({
    title: existing ? "Uredi oglas" : "Novi oglas", submit: existing ? "Spremi promjene" : "Objavi oglas",
    done: existing ? "Spremljeno" : "Objavljeno", values: existing || { valuta: "EUR" }, fields: oglasFields(!!existing),
    save: async (v, files) => {
      const id = existing?.id || crypto.randomUUID();
      const row = { naslov: v.naslov, kategorija: v.kategorija, stanje: v.stanje, cijena: v.cijena === "" ? null : Number(v.cijena),
        valuta: v.valuta || "EUR", grad: v.grad, drzava: v.drzava, opis: v.opis, kontakt: v.kontakt };
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
  if (!session) return h("div", { class: "contact" }, h("a", { href: "#prijava", onclick: () => { try { sessionStorage.setItem("povratak", location.hash); } catch {} } }, "Prijavi se"), " da vidiš kontakt.");
  if (!o.kontakt) return null;
  const c = h("button", { class: "btn small quiet", type: "button", onclick: async () => {
    try { await navigator.clipboard.writeText(o.kontakt); toast("Kontakt je kopiran"); } catch { toast("Označi kontakt i kopiraj ga ručno"); }
  } }, "Kopiraj");
  return h("div", { class: "contact" }, "Kontakt:", h("code", {}, o.kontakt), c);
}
function expander(key, summary, body) {
  const d = h("details", { open: open.has(key), ontoggle: () => { d.open ? open.add(key) : open.delete(key); } }, summary);
  d.append(h("div", { class: "more" }, body));
  return d;
}
const pageHead = (title, text, btn) => h("div", { class: "head-row" }, h("div", {}, h("h1", {}, title), text ? h("p", {}, text) : null), btn);
const metaHead = (title, meta, btn) => h("div", { class: "head-row" }, h("div", {}, h("h1", {}, title), h("div", { class: "meta" }, meta)), btn);

function thumb(o) {
  if (o.slike?.length) return h("img", { class: "thumb", src: imgUrl(o.slike[0]), alt: "", loading: "lazy", width: 56, height: 56 });
  return h("span", { class: "thumb", "aria-hidden": "true" }, o.kategorija?.[0] || "♪");
}
const adRow = (o, tag = "summary", href) => h(tag, { class: "row thumbed", href }, thumb(o), h("h3", {}, o.naslov),
  h("div", { class: "value" }, price(o)),
  h("div", { class: "meta" }, h("span", {}, o.kategorija), h("span", {}, o.stanje), h("span", {}, place(o)), h("span", {}, nameOf(o.autor)), h("span", {}, date(o.created_at))));
const jobRow = (o, tag = "summary", href) => h(tag, { class: "row", href }, h("h3", {}, o.naslov),
  h("div", { class: "value" }, o.honorar || "Po dogovoru"),
  h("div", { class: "meta" }, h("span", {}, o.vrsta), h("span", {}, place(o)), o.rok ? h("span", {}, "Rok: " + day(o.rok)) : null, h("span", {}, nameOf(o.autor)), h("span", {}, date(o.created_at))));
const threadRow = t => h("a", { class: "row", href: "#tema-" + t.id }, h("h3", {}, t.naslov),
  h("div", { class: "value" }, String(t.broj_odgovora ?? 0), h("small", {}, "odg.")),
  h("div", { class: "meta" }, h("span", {}, t.kategorija), h("span", {}, nameOf(t.autor)), h("span", {}, date(t.created_at))));
const bars = g => h("div", { class: "bars" }, CRIT.map(([k, l]) => h("div", { class: "bar" }, h("span", {}, l),
  h("i", {}, h("b", { vars: { "--w": `${(Number(g[k]) || 0) / 5 * 100}%` } })), h("span", {}, g.broj_ocjena ? dec(g[k]) : "–"))));
const scoreBox = g => h("div", { class: "score" }, g.broj_ocjena ? dec(g.prosjek) : "–", h("small", {}, plural(g.broj_ocjena || 0, "ocjena", "ocjene", "ocjena")));
const gearCard = g => h("a", { class: "gear-card", href: "#oprema-" + g.id }, scoreBox(g), h("h3", {}, g.naziv), h("div", { class: "meta" }, h("span", {}, g.kategorija)), bars(g));
const fill = (el, items, emptyEl) => el.replaceChildren(...(items.length ? items : [emptyEl]));

function adBody(o) {
  return [
    o.slike?.length ? h("div", { class: "gallery" }, o.slike.map(p => h("a", { href: imgUrl(p), target: "_blank", rel: "noopener" }, h("img", { src: imgUrl(p), alt: o.naslov, loading: "lazy" })))) : null,
    h("p", {}, o.opis), contact(o),
    h("div", { class: "actions" },
      canEdit(o) ? h("button", { class: "btn small quiet", type: "button", onclick: () => oglasForm(o) }, "Uredi") : null,
      delBtn(o, async () => { await removeSlike(o.slike); await q(sb.from("oglasi").delete().eq("id", o.id)); })),
  ];
}
function jobBody(o) {
  return [h("p", {}, o.opis), contact(o), h("div", { class: "actions" },
    canEdit(o) ? h("button", { class: "btn small quiet", type: "button", onclick: () => posaoForm(o) }, "Uredi") : null,
    delBtn(o, () => q(sb.from("poslovi").delete().eq("id", o.id))))];
}

/* ------------------------------------------------------------------ */
/* Stranice                                                            */
/* ------------------------------------------------------------------ */
let redraw = () => {};

const views = {
  async pocetna(_, alive) {
    const door = (href, label, y, stem, cls, key) => h("a", { class: "door " + cls, href: "#" + href, vars: { "--y": y, "--stem": stem } },
      cls.includes("low") ? h("span", { class: "ledger" }) : null, h("span", { class: "stem" }), h("span", { class: "head" }, h("span", { "data-c": key }, "–")), h("span", { class: "label" }, label));
    $("hero").replaceChildren(h("section", { class: "band" }, h("div", { class: "wrap" },
      h("div", {}, h("h1", {}, "BisStage"), h("p", { class: "lead" }, "Kupi i prodaj instrumente, nađi svirku, pitaj kolege i ocijeni opremu. Za glazbenike iz Hrvatske i regije.")),
      h("nav", { class: "staff", "aria-label": "Dijelovi stranice" },
        door("oglasi", "Oglasnik", 5.5, 2.5, "low", "oglasi"), door("poslovi", "Burza poslova", 4.5, 1.5, "", "poslovi"),
        door("forum", "Forum", 3.5, .5, "", "teme"), door("ocjene", "Ocjene opreme", 2, 2, "down", "oprema")))));
    const box = (title, href, cls = "rows") => { const list = h("div", { class: cls }, loading()); return [list, h("section", {}, h("h2", {}, title, h("a", { href: "#" + href }, "Sve")), list)]; };
    const [a, as] = box("Novi oglasi", "oglasi"), [j, js] = box("Novi poslovi", "poslovi"), [t, ts] = box("Na forumu", "forum"), [g, gs] = box("Najbolje ocijenjeno", "ocjene", "stack");
    $("main").replaceChildren(h("div", { class: "home" }, as, js, ts, gs));

    const newest = (tbl, cols, n = 3) => q(sb.from(tbl).select(cols).order("created_at", { ascending: false }).limit(n));
    const count = tbl => sb.from(tbl).select("id", { count: "exact", head: true }).then(r => r.count ?? "–");
    const [og, po, te, op, ...counts] = await Promise.all([
      newest("oglasi", OGLAS_JAVNO), newest("poslovi", POSAO_JAVNO), newest("teme_pregled", "*"),
      q(sb.from("oprema_pregled").select("*").gt("broj_ocjena", 0).order("prosjek", { ascending: false }).limit(2)),
      count("oglasi"), count("poslovi"), count("teme"), count("oprema"),
    ]);
    await loadNames([...og, ...po, ...te].map(x => x.autor));
    if (!alive()) return;
    ["oglasi", "poslovi", "teme", "oprema"].forEach((k, i) => { const el = document.querySelector(`[data-c="${k}"]`); if (el) el.textContent = counts[i]; });
    fill(a, og.map(o => adRow(o, "a", "#oglasi")), emptyBox("Još nema oglasa", "Objavi prvi oglas u Oglasniku."));
    fill(j, po.map(o => jobRow(o, "a", "#poslovi")), emptyBox("Još nema poslova", "Objavi prvi posao na Burzi poslova."));
    fill(t, te.map(threadRow), emptyBox("Još nema tema", "Otvori prvu temu na Forumu."));
    fill(g, op.map(gearCard), emptyBox("Još nema ocjena", "Dodaj opremu u Ocjenama opreme."));
  },

  async oglasi(_, alive) {
    const st = filters.oglasi, list = h("div", { class: "rows" }, loading());
    $("main").replaceChildren(
      pageHead("Oglasnik", "Instrumenti i oprema, novi i rabljeni.", h("button", { class: "btn", type: "button", onclick: () => oglasForm() }, "Objavi oglas")),
      h("div", { class: "tools" }, search("q-oglasi", "Pretraži", st, "npr. tambura, Split"), pick("c-oglasi", "Kategorija", st, "cat", CATS), pick("d-oglasi", "Država", st, "drzava", COUNTRIES)),
      list);
    const rows = await q(sb.from("oglasi").select(session ? OGLAS_JAVNO + ",kontakt" : OGLAS_JAVNO).order("created_at", { ascending: false }).limit(LIMIT));
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
    const rows = await q(sb.from("poslovi").select(session ? POSAO_JAVNO + ",kontakt" : POSAO_JAVNO).order("created_at", { ascending: false }).limit(LIMIT));
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
    $("main").replaceChildren(pageHead("Forum", "Pitanja, savjeti i razgovori među glazbenicima.", h("button", { class: "btn", type: "button", onclick: newTopic }, "Otvori temu")), chips, list);
    const rows = await q(sb.from("teme_pregled").select("*").order("created_at", { ascending: false }).limit(LIMIT));
    await loadNames(rows.map(r => r.autor));
    if (!alive()) return;
    redraw = () => {
      chips.replaceChildren(...["", ...TOPICS].map(k => h("button", { class: "chip", type: "button", "aria-pressed": String(st.kat === k), onclick: () => { st.kat = k; redraw(); } }, k || "Sve teme")));
      fill(list, rows.filter(t => !st.kat || t.kategorija === st.kat).map(threadRow), rows.length ? emptyBox("Nema tema u ovoj kategoriji", "Odaberi drugu ili otvori novu temu.") : emptyBox("Još nema tema", "Otvori prvu temu."));
    };
    redraw();
  },

  async tema(id, alive) {
    const box = h("div", { class: "stack" }, loading()), list = h("div", { class: "stack" });
    $("main").replaceChildren(h("a", { class: "back", href: "#forum" }, "Natrag na forum"), box, list);
    const [t] = await q(sb.from("teme").select("*").eq("id", id).limit(1));
    if (!t) { if (alive()) box.replaceChildren(emptyBox("Ova tema više ne postoji", "Vrati se na forum.")); return; }
    const rs = await q(sb.from("odgovori").select("*").eq("tema", id).order("created_at"));
    await loadNames([t.autor, ...rs.map(r => r.autor)]);
    if (!alive()) return;
    box.replaceChildren(metaHead(t.naslov, [h("span", {}, t.kategorija), h("span", {}, nameOf(t.autor)), h("span", {}, date(t.created_at))]),
      h("article", { class: "post" }, h("p", { class: "prose" }, t.tekst), h("div", { class: "actions" }, delBtn(t, async () => { await q(sb.from("teme").delete().eq("id", t.id)); location.hash = "#forum"; }))));
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
      form = h("p", {}, h("a", { href: "#prijava", onclick: () => { try { sessionStorage.setItem("povratak", location.hash); } catch {} } }, "Prijavi se"), " da odgovoriš.");
    }
    list.replaceChildren(h("h2", {}, plural(rs.length, "odgovor", "odgovora", "odgovora")),
      ...rs.map(r => h("article", { class: "post" }, h("div", { class: "meta" }, h("span", {}, nameOf(r.autor)), h("span", {}, date(r.created_at))), h("p", { class: "prose" }, r.tekst),
        h("div", { class: "actions" }, delBtn(r, () => q(sb.from("odgovori").delete().eq("id", r.id)))))), form);
  },

  async ocjene(_, alive) {
    const st = filters.ocjene, list = h("div", { class: "gear" }, loading());
    const add = () => {
      if (needLogin()) return;
      openForm({ title: "Nova oprema", submit: "Dodaj opremu", done: "Dodano",
        fields: [{ name: "naziv", label: "Proizvođač i model", required: true, max: 90, min_len: 2 }, { name: "kategorija", label: "Kategorija", options: CATS, required: true }],
        save: v => q(sb.from("oprema").insert({ naziv: v.naziv, kategorija: v.kategorija })) });
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
    $("main").replaceChildren(h("a", { class: "back", href: "#ocjene" }, "Natrag na ocjene"), box, list);
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
    box.replaceChildren(metaHead(g.naziv, [h("span", {}, g.kategorija)], h("button", { class: "btn", type: "button", onclick: rate }, mine ? "Promijeni ocjenu" : "Ocijeni")),
      h("div", { class: "post" }, scoreBox(g), bars(g), h("div", { class: "actions" }, delBtn(g, async () => { await q(sb.from("oprema").delete().eq("id", g.id)); location.hash = "#ocjene"; }))));
    list.replaceChildren(h("h2", {}, "Iskustva korisnika"),
      ...(rs.length ? rs.map(r => h("article", { class: "post" },
        h("div", { class: "meta" }, h("span", {}, nameOf(r.autor)), h("span", {}, date(r.created_at)), ...CRIT.map(([k, l]) => h("span", {}, `${l} ${r[k]}/5`))),
        h("p", { class: "prose" }, r.tekst), h("div", { class: "actions" }, delBtn(r, () => q(sb.from("recenzije").delete().eq("id", r.id)))))) : [emptyBox("Još nema ocjena", "Budi prvi koji će ocijeniti ovaj model.")]));
  },

  /* ---------------- Pravila ---------------- */
  async privatnost() { legalPage(window.PRAVNO.privatnost); },
  async uvjeti() { legalPage(window.PRAVNO.uvjeti); },

  /* ---------------- Računi ---------------- */
  async prijava() {
    if (session) { location.hash = "#racun"; return; }
    authPage("Prijava", "Prijavi se da objavljuješ oglase, poslove i odgovore.", [
      { name: "email", label: "E-mail", type: "email", auto: "email" },
      { name: "lozinka", label: "Lozinka", type: "password", auto: "current-password" }],
      "Prijavi se", async v => {
        await q(sb.auth.signInWithPassword({ email: v.email, password: v.lozinka }));
        let back = "#pocetna"; try { back = sessionStorage.getItem("povratak") || back; sessionStorage.removeItem("povratak"); } catch {}
        location.hash = back; toast("Prijavljen si");
      },
      [h("a", { href: "#zaboravljena-lozinka" }, "Zaboravio si lozinku?"), h("span", {}, "Nemaš račun? ", h("a", { href: "#registracija" }, "Registriraj se"))]);
  },

  async registracija() {
    if (session) { location.hash = "#racun"; return; }
    authPage("Registracija", "Besplatno. Ime koje upišeš vidjet će drugi uz tvoje objave. Poslat ćemo ti e-poruku za potvrdu računa, pa provjeri i neželjenu poštu.", [
      { name: "ime", label: "Ime ili nadimak", type: "text", auto: "nickname", max: 60 },
      { name: "email", label: "E-mail", type: "email", auto: "email" },
      { name: "lozinka", label: "Lozinka", type: "password", auto: "new-password", min: 8, hint: "Najmanje 8 znakova." }],
      "Registriraj se", async (v, ok) => {
        const data = await q(sb.auth.signUp({ email: v.email, password: v.lozinka, options: { data: { ime: v.ime }, emailRedirectTo: location.origin + "/" } }));
        if (data.session) { location.hash = "#pocetna"; toast("Dobro došao na BisStage"); }
        else ok("Poslali smo ti e-poruku. Klikni poveznicu u njoj da potvrdiš račun, a zatim se prijavi. Ako poruku ne vidiš za nekoliko minuta, provjeri neželjenu poštu (Spam).");
      },
      [h("span", {}, "Već imaš račun? ", h("a", { href: "#prijava" }, "Prijavi se"))], true,
      h("label", { class: "check", for: "a-uvjeti" }, h("input", { id: "a-uvjeti", name: "uvjeti", type: "checkbox", required: true }),
        h("span", {}, "Imam najmanje 16 godina i prihvaćam ", h("a", { href: "#uvjeti", target: "_blank" }, "Uvjete korištenja"), " i ",
          h("a", { href: "#privatnost", target: "_blank" }, "Pravila privatnosti"), ".")));
  },

  async ["zaboravljena-lozinka"]() {
    authPage("Nova lozinka", "Upiši e-mail i poslat ćemo ti poveznicu za novu lozinku. Otvori je u istom pregledniku.", [
      { name: "email", label: "E-mail", type: "email", auto: "email" }],
      "Pošalji poveznicu", async (v, ok) => {
        await q(sb.auth.resetPasswordForEmail(v.email, { redirectTo: location.origin + "/?reset=1" }));
        ok("Ako postoji račun s tom adresom, poslali smo ti poveznicu. Ako je ne vidiš, provjeri neželjenu poštu (Spam).");
      }, [h("a", { href: "#prijava" }, "Natrag na prijavu")], false);
  },

  async ["nova-lozinka"]() {
    if (!session) { authPage("Poveznica je istekla", "Zatraži novu poveznicu za promjenu lozinke.", [], null, null, [h("a", { class: "btn", href: "#zaboravljena-lozinka" }, "Zatraži novu poveznicu")], false); return; }
    authPage("Postavi novu lozinku", "Upiši novu lozinku za svoj račun.", [
      { name: "lozinka", label: "Nova lozinka", type: "password", auto: "new-password", min: 8, hint: "Najmanje 8 znakova." }],
      "Spremi lozinku", async () => {
        await q(sb.auth.updateUser({ password: $("a-lozinka").value }));
        location.hash = "#pocetna"; toast("Lozinka je promijenjena");
      }, [], false);
  },

  async racun(_, alive) {
    if (!session) { location.hash = "#prijava"; return; }
    const err = h("p", { class: "err", role: "alert" });
    const name = h("input", { id: "r-ime", required: true, maxlength: 60, value: me?.ime || "" });
    const save = h("button", { class: "btn", type: "submit" }, "Spremi ime");
    const counts = h("p", {}, "Učitavam tvoje objave…");
    $("main").replaceChildren(h("div", { class: "auth" },
      h("h1", {}, "Moj račun"),
      h("p", {}, session.user.email),
      h("form", { onsubmit: async e => {
        e.preventDefault(); save.disabled = true; err.textContent = "";
        try { await q(sb.from("profili").update({ ime: name.value.trim() }).eq("id", uid())); nameCache.delete(uid()); await loadMe(); renderAccount(); toast("Ime je spremljeno"); }
        catch (x) { err.textContent = errText(x); }
        save.disabled = false;
      } }, h("label", { class: "field", for: "r-ime" }, "Ime koje drugi vide", name), err, h("div", {}, save)),
      counts,
      me?.admin ? h("p", {}, h("span", { class: "tag" }, "Administrator"), " Možeš brisati sve objave.") : null,
      h("p", {}, "Za brisanje računa i svih podataka piši na ", h("a", { href: "mailto:kontakt@bisstage.com" }, "kontakt@bisstage.com"), " s ove e-mail adrese."),
      h("div", { class: "actions" },
        h("a", { class: "btn quiet", href: "#zaboravljena-lozinka" }, "Promijeni lozinku"),
        h("button", { class: "btn danger", type: "button", onclick: async () => { await sb.auth.signOut(); location.hash = "#pocetna"; toast("Odjavljen si"); } }, "Odjavi se"))));
    const c = tbl => sb.from(tbl).select("id", { count: "exact", head: true }).eq("autor", uid()).then(r => r.count ?? 0);
    const [o, p, t] = await Promise.all([c("oglasi"), c("poslovi"), c("teme")]);
    if (alive()) counts.textContent = `Objavio si ${plural(o, "oglas", "oglasa", "oglasa")}, ${plural(p, "posao", "posla", "poslova")} i ${plural(t, "temu", "teme", "tema")}.`;
  },
};

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
  } }, "Nastavi s Google računom"), h("div", { class: "or" }, "ili")] : [];
  $("main").replaceChildren(h("div", { class: "auth" }, h("h1", {}, title), h("p", {}, text), ...g, form, h("div", { class: "actions" }, links)));
}

/* ------------------------------------------------------------------ */
/* Usmjeravanje i pokretanje                                           */
/* ------------------------------------------------------------------ */
const NAV_OF = { tema: "forum", oprema: "ocjene", prijava: "account", registracija: "account", racun: "account" };

async function route(keepScroll) {
  const token = ++navToken;
  const alive = () => token === navToken;
  const raw = location.hash.slice(1) || "pocetna";
  const m = raw.match(/^(tema|oprema)-([0-9a-f-]{36})$/);
  const name = m ? m[1] : views[raw] ? raw : "pocetna";
  redraw = () => {};
  if (name !== "pocetna") $("hero").replaceChildren();
  const navName = NAV_OF[name] || name;
  document.querySelectorAll("#nav a").forEach(a => a.getAttribute("href") === "#" + navName ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
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
function renderAccount() {
  const a = $("account");
  if (session) { a.textContent = me?.ime || "Moj račun"; a.href = "#racun"; }
  else { a.textContent = "Prijava"; a.href = "#prijava"; }
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
  if (location.search) history.replaceState(null, "", location.pathname + (params.get("reset") ? "#nova-lozinka" : location.hash));
  if (params.get("error_description")) toast("Poveznica nije valjana ili je istekla. Zatraži novu.");
  await loadMe();
  renderAccount();
  sb.auth.onAuthStateChange((event, s) => {
    if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") { session = s; return; }
    setTimeout(async () => {
      session = s;
      await loadMe();
      renderAccount();
      if (event === "PASSWORD_RECOVERY") { location.hash = "#nova-lozinka"; return; }
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") refresh();
    }, 0);
  });
  addEventListener("hashchange", () => route());
  route();
}
boot();
