/**
 * circling.fi – rakentaa staattiset sivut tekstit.md:stä.
 * Cloudflare Pages ajaa tämän jokaisen julkaisun yhteydessä (npm run build → dist/). netlify.toml on vanhalta Netlifyltä.
 * Tekstejä EI muokata täällä, vaan tekstit.md:ssä.
 */
const fs = require("fs");
const path = require("path");
const { marked } = require("marked");

const SITE = (process.env.URL || "https://circling.fi").replace(/\/$/, "");
const API = "https://script.google.com/macros/s/AKfycbw_soiWMMAg7gSkyd8rVzcow8D1Kyx5x-6alziVkjKfvEJwHbowkCtbr3uc2hWIStLq8w/exec";
const OUT = path.join(__dirname, "dist");
const KUUT = ["tammi","helmi","maalis","huhti","touko","kesä","heinä","elo","syys","loka","marras","joulu"];
const VALIKKONIMET = { "etusivu": "Etusivu" };

const slug = s => s.toLowerCase().replace(/ä/g,"a").replace(/ö/g,"o").replace(/å/g,"a").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const pelkkaTeksti = h => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const polku = id => id === "etusivu" ? "/" : `/${id}/`;

const KORISTE = `<svg class="koriste" viewBox="0 0 400 400" aria-hidden="true"><circle cx="200" cy="200" r="150" fill="none" stroke="var(--turkoosi)" stroke-width="13"/><circle cx="200" cy="200" r="31" fill="var(--turkoosi)"/></svg>`;

/* ---------- Illat ---------- */
async function haeIllat() {
  try {
    const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 15000);
    const d = await (await fetch(API, { signal: ctrl.signal, redirect: "follow" })).json();
    if (d && d.ok && Array.isArray(d.illat)) return d.illat;
  } catch (e) { console.warn("Iltojen haku ei onnistunut, käytetään tekstit.md:n varailtoja:", e.message); }
  return null;
}
function varaIllat(md) {
  const nyt = new Date();
  return md.split("\n").filter(r => /^@\s/.test(r.trim())).map(r => {
    const [pvm, aika = "", otsikko = "", paikka = ""] = r.trim().replace(/^@\s*/, "").split("|").map(s => s.trim());
    const [d, m, y] = pvm.split(".").map(Number);
    const ajat = (aika.match(/(\d{1,2})[.:](\d{2})\s*[–-]\s*(\d{1,2})[.:](\d{2})/) || []);
    return { id: "", paiva: d, kuukausi: m, vuosi: y, viikonpaiva: "", alku: ajat[1] ? `${ajat[1]}.${ajat[2]}` : "", loppu: ajat[3] ? `${ajat[3]}.${ajat[4]}` : "",
             otsikko, tyyppi: /avoin/i.test(otsikko) ? "avoin" : /joulu/i.test(otsikko) ? "joulu" : "tavallinen", paikka, _pvm: new Date(y, m - 1, d, 23, 59) };
  }).filter(e => !isNaN(e._pvm) && e._pvm >= nyt).sort((a, b) => a._pvm - b._pvm);
}
function staattinenKortti(e) {
  const luokka = e.tyyppi === "avoin" ? " avoin" : e.tyyppi === "joulu" ? " joulu" : "";
  const aika = [e.viikonpaiva, e.alku && `klo ${e.alku}${e.loppu ? "–" + e.loppu : ""}`].filter(Boolean).join(" ");
  return `<a class="ilta${luokka}" href="/tulevat-illat/">
    <div class="pvm"><div class="d">${e.paiva}</div><div class="m">${KUUT[e.kuukausi - 1] || ""}</div></div>
    <div><h3>${esc(e.otsikko)}</h3><div class="meta">${esc(aika)}</div></div>
    <span class="tila">Ilmoittaudu</span></a>`;
}
function iltaLista(illat, max) {
  const lista = max ? illat.slice(0, max) : illat;
  const sis = lista.length ? `<div class="illat">${lista.map(staattinenKortti).join("")}</div>` : `<p class="ei-iltoja">Uusia iltoja tulossa pian.</p>`;
  return `<div class="illat-api" data-max="${max || ""}">${sis}</div>`;
}
function iso(e, aika) {
  const [h, m] = String(aika || "18.00").split(/[.:]/);
  const kk = String(e.kuukausi).padStart(2, "0"), pv = String(e.paiva).padStart(2, "0");
  // Suomen aika: talvella +02:00, kesällä +03:00 (likimain maalis–loka)
  const kesa = e.kuukausi > 3 && e.kuukausi < 11;
  return `${e.vuosi}-${kk}-${pv}T${String(h).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}:00${kesa ? "+03:00" : "+02:00"}`;
}
function tapahtumaData(illat) {
  if (!illat.length) return "";
  const data = illat.map(e => ({
    "@context": "https://schema.org", "@type": "Event",
    name: e.otsikko,
    startDate: iso(e, e.alku), endDate: iso(e, e.loppu || e.alku),
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    eventStatus: "https://schema.org/EventScheduled",
    inLanguage: "fi",
    location: { "@type": "Place", name: "Galleria Sitruunapuu",
      address: { "@type": "PostalAddress", streetAddress: "Sammatintie 2", postalCode: "00550", addressLocality: "Helsinki", addressCountry: "FI" } },
    description: "Circling-ilta Helsingin Vallilassa: läsnäolon, autenttisuuden ja tietoisen vuorovaikutuksen harjoitus ryhmässä.",
    image: [`${SITE}/jakokuva.jpg`],
    organizer: { "@type": "Organization", name: "Yhteyspiiri – circling.fi", url: SITE + "/" },
    offers: { "@type": "Offer", price: "29", priceCurrency: "EUR", availability: "https://schema.org/InStock",
      url: "https://holvi.com/shop/kehoyhteys/section/yhteyspiiri-circling/" }
  }));
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

/* ---------- Sivut ---------- */
function pilko(md) {
  const sivut = [];
  md.split(/^===\s*(.+?)\s*===\s*$/m).forEach((osa, i, arr) => {
    if (i % 2 === 1) {
      const piilo = /^\(.*\)$/.test(osa);
      const nimi = osa.replace(/^\((.*)\)$/, "$1");
      sivut.push({ nimi, id: slug(nimi), piilo, teksti: arr[i + 1] || "" });
    }
  });
  return sivut;
}
function renderoi(teksti, illat) {
  let t = teksti.replace(/(^@\s.*$\n?)+/m, "\n%%ILLAT_KAIKKI%%\n\n");
  let html = marked.parse(t);
  html = html.replace(/<p>\s*%%ILLAT_KAIKKI%%\s*<\/p>/, iltaLista(illat))
    .replace(/<p>\s*\{\{illat\}\}\s*<\/p>/g, iltaLista(illat, 3))
    .replace(/<blockquote>\s*<p>([\s\S]*?)<\/p>\s*<\/blockquote>/g, '<p class="slogan">$1</p>')
    .replace(/<p>\s*\{\{kuva\}\}\s*<\/p>/g, KORISTE)
    .replace(/<a href="([^"]*)">([^<]*)<\/a>\{(nappi2?)\}/g, '<a class="$3" href="$1">$2</a>')
    // sisäiset #-linkit omille sivuille
    .replace(/href="#([a-z0-9-]+)"/g, (m, id) => `href="${polku(id)}"`)
    // kuvat juuresta
    .replace(/src="(?!https?:|\/|data:)([^"]+)"/g, 'src="/$1"');
  return html;
}
function kuvaus(sivu, html) {
  const p = (html.match(/<p(?![^>]*class="slogan")[^>]*>([\s\S]*?)<\/p>/g) || []).map(pelkkaTeksti).find(x => x.length > 60) || "";
  return p.length > 158 ? p.slice(0, 155).replace(/\s+\S*$/, "") + "…" : p;
}

async function main() {
  let md = fs.readFileSync(path.join(__dirname, "tekstit.md"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
  const sivut = pilko(md);
  const illat = (await haeIllat()) || varaIllat(md);
  console.log(`Illat: ${illat.length} kpl`);

  const ala = sivut.find(s => s.id === "alatunniste");
  const alaHtml = ala ? renderoi(ala.teksti, illat) : "";
  const nakyvat = sivut.filter(s => s.id !== "alatunniste");
  const pohja = fs.readFileSync(path.join(__dirname, "pohja.html"), "utf8");

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const sivukartta = [];
  for (const s of nakyvat) {
    let html = renderoi(s.teksti, illat);
    // Jokaisella sivulla yksi h1 (hakukoneita varten): ensimmäinen h2 → h1, ulkoasu pysyy samana
    if (!/<h1[\s>]/.test(html)) html = html.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/, '<h1 class="h2-tyyli"$1>$2</h1>');
    const en = s.id === "en";
    const otsikko = s.id === "etusivu" ? "Circling Helsinki – Yhteyspiiri | circling.fi"
      : en ? "Circling in Helsinki – Yhteyspiiri (in English) | circling.fi"
      : `${s.nimi} – Circling Helsinki | circling.fi`;
    const desc = s.id === "etusivu"
      ? "Circling-iltoja Helsingissä: läsnäolon, autenttisuuden ja tietoisen vuorovaikutuksen illat Vallilassa – circling, authentic relating ja kehollisuus. Yhteyspiiri kokoontuu maanantaisin."
      : kuvaus(s, html);
    const nav = nakyvat.filter(x => !x.piilo).map(x =>
      `<a href="${polku(x.id)}"${x.id === s.id ? ' class="on" aria-current="page"' : ""}>${esc(VALIKKONIMET[x.id] || x.nimi)}</a>`).join("");
    const ld = (s.id === "etusivu" || s.id === "tulevat-illat") ? tapahtumaData(illat) : "";
    const url = SITE + polku(s.id);
    const sivu = pohja
      .replace(/%%LANG%%/g, en ? "en" : "fi")
      .replace(/%%TITLE%%/g, esc(otsikko))
      .replace(/%%DESC%%/g, esc(desc))
      .replace(/%%URL%%/g, url)
      .replace(/%%SITE%%/g, SITE)
      .replace("%%LD%%", ld)
      .replace("%%NAV%%", nav)
      .replace("%%SISALTO%%", `<section class="sivu on" id="sivu-${s.id}">${html}</section>`)
      .replace("%%ALA%%", alaHtml)
      .replace(/%%NOINDEX%%/g, s.piilo ? '<meta name="robots" content="noindex">' : "");
    const kansio = s.id === "etusivu" ? OUT : path.join(OUT, s.id);
    fs.mkdirSync(kansio, { recursive: true });
    fs.writeFileSync(path.join(kansio, "index.html"), sivu);
    if (!s.piilo) sivukartta.push(url);
  }

  for (const f of ["tyyli.css", "sivu.js", "kansikuva.jpg", "jakokuva.jpg", "_redirects"])
    if (fs.existsSync(path.join(__dirname, f))) fs.copyFileSync(path.join(__dirname, f), path.join(OUT, f));
  for (const f of fs.readdirSync(__dirname)) // muut kuvat (esim. muotokuvat)
    if (/\.(jpe?g|png|webp|svg)$/i.test(f) && !fs.existsSync(path.join(OUT, f))) fs.copyFileSync(path.join(__dirname, f), path.join(OUT, f));

  const tanaan = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(OUT, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    sivukartta.map(u => `  <url><loc>${u}</loc><lastmod>${tanaan}</lastmod></url>`).join("\n") + `\n</urlset>\n`);
  fs.writeFileSync(path.join(OUT, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
  console.log(`Valmis: ${nakyvat.length} sivua → dist/ (osoite ${SITE})`);
}
main().catch(e => { console.error(e); process.exit(1); });
