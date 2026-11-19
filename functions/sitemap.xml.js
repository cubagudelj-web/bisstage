import { rest } from "../lib/seo.js";

// Karta stranice za Google: početne stranice dijelova i sve javne objave.
export async function onRequestGet({ request }) {
  const origin = new URL(request.url).origin;
  const fixed = ["/", "/oglasi", "/poslovi", "/forum", "/ocjene", "/dogadaji", "/uvjeti", "/privatnost"];
  const parts = [["oglas", "oglasi"], ["posao", "poslovi"], ["tema", "teme"], ["oprema", "oprema"], ["dogadaj", "dogadaji"]];
  const lists = await Promise.all(parts.map(([, t]) => rest(`${t}?select=id,created_at&order=created_at.desc&limit=5000`).catch(() => null)));
  const urls = fixed.map(p => `<url><loc>${origin}${p}</loc></url>`);
  parts.forEach(([k], i) => (lists[i] || []).forEach(r => urls.push(`<url><loc>${origin}/${k}/${r.id}</loc><lastmod>${String(r.created_at).slice(0, 10)}</lastmod></url>`)));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
