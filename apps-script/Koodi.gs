/**
 * Circling – ilmoittautumiset (kokeiluversio)
 * ------------------------------------------------------------
 * Liitä tämä koko tiedosto Sheetin Apps Scriptiin (Laajennukset → Apps Script).
 * Välilehdet: Illat, Ilmoittautumiset, Asetukset.
 *
 * Tekee:
 *  - antaa nettisivulle tulevat illat (doGet)
 *  - vastaanottaa ilmoittautumiset sivulta (doPost), lähettää vahvistuksen
 *  - peruutuslinkki sähköpostissa (doGet ?peru=...)
 *  - muistutus päivää ennen iltaa niille, jotka valitsivat sen (ajastettu, tunnin välein)
 *  - "Lisää kalenteriin" -linkki ja kalenteritiedosto vahvistusviestissä
 *  - salainen osallistujasivu (?lista=avain), linkki Circling-valikosta
 *  - kalenterimerkinnät illoista (ajastettu + valikosta)
 */

const TZ = 'Europe/Helsinki';
const VIIKONPAIVAT = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];

// ---------- Apufunktiot ----------

function sheet_(nimi) {
  return SpreadsheetApp.getActive().getSheetByName(nimi);
}

function asetukset_() {
  const sh = sheet_('Asetukset');
  const rivit = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 2).getValues();
  const o = {};
  rivit.forEach(r => { if (r[0]) o[String(r[0]).trim()] = r[1]; });
  return o;
}

function aikaTeksti_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'H.mm');
  return String(v || '').trim().replace(':', '.');
}

function pvmAvain_(d) {
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

function hetki_(pvm, aika) {
  const t = aikaTeksti_(aika).split('.');
  const hh = ('0' + (parseInt(t[0], 10) || 0)).slice(-2);
  const mm = ('0' + (parseInt(t[1], 10) || 0)).slice(-2);
  return Utilities.parseDate(pvmAvain_(pvm) + ' ' + hh + ':' + mm, TZ, 'yyyy-MM-dd HH:mm');
}

function pvmNaytto_(d) {
  const vp = VIIKONPAIVAT[Number(Utilities.formatDate(d, TZ, 'u')) % 7];
  return vp + ' ' + Utilities.formatDate(d, TZ, 'd.M.yyyy');
}

function tayta_(pohja, arvot) {
  return String(pohja || '').replace(/\{(\w+)\}/g, (m, k) => (k in arvot ? arvot[k] : m));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Lukee Illat-välilehden. */
function illat_() {
  const sh = sheet_('Illat');
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const rivit = sh.getRange(2, 1, n, 10).getValues();
  const maarat = ilmoittautuneet_();
  const tulos = [];
  rivit.forEach((r, i) => {
    if (!(r[0] instanceof Date)) return;
    const id = pvmAvain_(r[0]) + '_' + (i + 2);
    const avain = pvmAvain_(r[0]);
    tulos.push({
      rivi: i + 2,
      id: id,
      pvm: r[0],
      alku: aikaTeksti_(r[1]),
      loppu: aikaTeksti_(r[2]),
      otsikko: String(r[3] || 'Circling-ilta'),
      tyyppi: String(r[4] || 'tavallinen'),
      paikka: String(r[5] || ''),
      max: Number(r[6]) || 0,
      ilmoittautuneita: maarat[avain] || 0,
      nakyvissa: r[8] === true,
      kalenteriId: String(r[9] || ''),
      alkaa: hetki_(r[0], r[1]),
      loppuu: hetki_(r[0], r[2] || r[1])
    });
  });
  return tulos;
}

/** Laskee ilmoittautuneet päivittäin (perutut pois). */
function ilmoittautuneet_() {
  const sh = sheet_('Ilmoittautumiset');
  const n = sh.getLastRow() - 1;
  const o = {};
  if (n < 1) return o;
  sh.getRange(2, 1, n, 7).getValues().forEach(r => {
    if (r[1] instanceof Date && r[6] !== 'Peruttu') {
      const k = pvmAvain_(r[1]);
      o[k] = (o[k] || 0) + 1;
    }
  });
  return o;
}

function lahetaPosti_(vastaanottaja, otsikko, teksti, liitteet) {
  const a = asetukset_();
  const etuliite = a['Kokeilutila'] === true ? '[TESTI] ' : '';
  const viesti = {
    to: vastaanottaja,
    subject: etuliite + otsikko,
    body: teksti,
    name: String(a['Lähettäjän nimi'] || 'circling.fi')
  };
  if (a['Vastausosoite']) viesti.replyTo = String(a['Vastausosoite']);
  if (liitteet) viesti.attachments = liitteet;
  MailApp.sendEmail(viesti);
}

function kello_(d) {
  return Utilities.formatDate(d, TZ, 'H.mm');
}

function utc_(d) {
  return Utilities.formatDate(d, 'UTC', "yyyyMMdd'T'HHmmss'Z'");
}

/** Linkki, joka lisää illan Google-kalenteriin. */
function kalenteriLinkki_(ilta) {
  const sivu = String(asetukset_()['Sivun osoite'] || '');
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    '&text=' + encodeURIComponent(ilta.otsikko) +
    '&dates=' + utc_(ilta.alkaa) + '/' + utc_(ilta.loppuu) +
    '&location=' + encodeURIComponent(ilta.paikka) +
    (sivu ? '&details=' + encodeURIComponent(sivu) : '');
}

/** Kalenteritiedosto (.ics) Apple- ja Outlook-kalentereille. */
function icsLiite_(ilta, tunniste) {
  const esc = t => String(t || '').replace(/([,;\\])/g, '\\$1');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//circling.fi//FI', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + tunniste + '@circling.fi',
    'DTSTAMP:' + utc_(new Date()),
    'DTSTART:' + utc_(ilta.alkaa),
    'DTEND:' + utc_(ilta.loppuu),
    'SUMMARY:' + esc(ilta.otsikko),
    'LOCATION:' + esc(ilta.paikka),
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
  return Utilities.newBlob(ics, 'text/calendar', 'circling-ilta.ics');
}

function postinArvot_(ilta, nimi, tunniste) {
  const a = asetukset_();
  const min = 60 * 1000;
  return {
    nimi: nimi,
    ilta: ilta.otsikko,
    pvm: pvmNaytto_(ilta.pvm),
    aika: ilta.alku + (ilta.loppu ? '–' + ilta.loppu : ''),
    alku: ilta.alku,
    ovet: kello_(new Date(ilta.alkaa - (Number(a['Ovet aukeavat minuuttia ennen']) || 0) * min)),
    viimeistaan: kello_(new Date(ilta.alkaa - (Number(a['Viimeistään minuuttia ennen']) || 0) * min)),
    kalenteri: kalenteriLinkki_(ilta),
    paikka: ilta.paikka,
    holvi: String(a['Holvi-linkki'] || ''),
    whatsapp: String(a['WhatsApp-linkki'] || ''),
    peruutus: ScriptApp.getService().getUrl() + '?peru=' + encodeURIComponent(tunniste)
  };
}

// ---------- Verkkosovellus ----------

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.peru) return peruutus_(p.peru);
  if (p.lista !== undefined) return osallistujasivu_(p.lista, p.ilta);

  const nyt = new Date();
  const illat = illat_()
    .filter(x => x.nakyvissa && x.loppuu > nyt)
    .sort((a, b) => a.alkaa - b.alkaa)
    .map(x => ({
      id: x.id,
      paiva: Number(Utilities.formatDate(x.pvm, TZ, 'd')),
      kuukausi: Number(Utilities.formatDate(x.pvm, TZ, 'M')),
      vuosi: Number(Utilities.formatDate(x.pvm, TZ, 'yyyy')),
      viikonpaiva: VIIKONPAIVAT[Number(Utilities.formatDate(x.pvm, TZ, 'u')) % 7],
      alku: x.alku,
      loppu: x.loppu,
      otsikko: x.otsikko,
      tyyppi: x.tyyppi,
      paikka: x.paikka,
      paikkoja: x.max,
      vapaana: x.max ? Math.max(x.max - x.ilmoittautuneita, 0) : null
    }));
  return json_({ ok: true, illat: illat });
}

function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, virhe: 'Virheellinen pyyntö.' }); }

  // Roskapostiansa: oikea ihminen ei täytä tätä kenttää.
  if (d.sivusto) return json_({ ok: true });
  if (d.toiminto === 'peru') return lahetaPeruutuslinkki_(d);

  const nimi = String(d.nimi || '').trim().slice(0, 100);
  const email = String(d.email || '').trim().toLowerCase().slice(0, 200);
  const viesti = String(d.viesti || '').trim().slice(0, 1000);
  if (!nimi) return json_({ ok: false, virhe: 'Kirjoita nimesi.' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json_({ ok: false, virhe: 'Tarkista sähköpostiosoite.' });

  const lukko = LockService.getScriptLock();
  lukko.waitLock(15000);
  try {
    const ilta = illat_().find(x => x.id === d.ilta);
    if (!ilta || !ilta.nakyvissa || ilta.loppuu < new Date()) return json_({ ok: false, virhe: 'Iltaa ei löytynyt. Päivitä sivu ja yritä uudelleen.' });

    const sh = sheet_('Ilmoittautumiset');
    const n = sh.getLastRow() - 1;
    if (n > 0 && email) {
      const onJo = sh.getRange(2, 1, n, 7).getValues().some(r =>
        r[1] instanceof Date && pvmAvain_(r[1]) === pvmAvain_(ilta.pvm) &&
        String(r[4]).toLowerCase() === email && r[6] !== 'Peruttu');
      if (onJo) return json_({ ok: true, jo: true });
    }
    if (ilta.max && ilta.ilmoittautuneita >= ilta.max) return json_({ ok: false, virhe: 'Ilta on valitettavasti täynnä.' });

    const tunniste = Utilities.getUuid();
    const muistutus = !!email && d.muistutus !== false;
    sh.getRange(seuraavaRivi_(sh), 1, 1, 10).setValues([[new Date(), ilta.pvm, ilta.otsikko, nimi, email, viesti, 'Ilmoittautunut', '', tunniste, muistutus]]);
    SpreadsheetApp.flush();

    const a = asetukset_();
    const arvot = postinArvot_(ilta, nimi, tunniste);
    if (email) lahetaPosti_(email, tayta_(a['Vahvistus: otsikko'], arvot), tayta_(a['Vahvistus: teksti'], arvot), [icsLiite_(ilta, tunniste)]);

    if (a['Ilmoitus järjestäjille']) {
      lahetaPosti_(String(a['Ilmoitus järjestäjille']),
        'Uusi ilmoittautuminen: ' + ilta.otsikko + ' ' + arvot.pvm,
        nimi + (email ? ' <' + email + '>' : ' (ei sähköpostia)') + '\n' + (viesti ? '\nViesti: ' + viesti + '\n' : '') +
        '\nIlmoittautuneita nyt: ' + (ilta.ilmoittautuneita + 1) + (ilta.max ? ' / ' + ilta.max : ''));
    }
    return json_({ ok: true });
  } finally {
    lukko.releaseLock();
  }
}

/** Ensimmäinen tyhjä rivi A-sarakkeen mukaan (ei välitä muiden sarakkeiden valintaruuduista). */
function seuraavaRivi_(sh) {
  const a = sh.getRange(1, 1, sh.getMaxRows(), 1).getValues();
  let i = a.length;
  while (i > 1 && a[i - 1][0] === '') i--;
  return i + 1;
}

/** Lähettää peruutuslinkin sähköpostiin (ei näytetä sivulla, jotta kukaan muu ei voi perua toisen paikkaa). */
function lahetaPeruutuslinkki_(d) {
  const email = String(d.email || '').trim().toLowerCase();
  if (!email) return json_({ ok: false, virhe: 'Peruminen vaatii sähköpostiosoitteen.' });
  const ilta = illat_().find(x => x.id === d.ilta);
  if (!ilta) return json_({ ok: false, virhe: 'Iltaa ei löytynyt.' });
  const sh = sheet_('Ilmoittautumiset');
  const n = sh.getLastRow() - 1;
  const rivi = n > 0 ? sh.getRange(2, 1, n, 9).getValues().find(r =>
    r[1] instanceof Date && pvmAvain_(r[1]) === pvmAvain_(ilta.pvm) &&
    String(r[4]).toLowerCase() === email && r[6] !== 'Peruttu') : null;
  if (rivi) {
    const arvot = postinArvot_(ilta, rivi[3], rivi[8]);
    lahetaPosti_(email, 'Peru ilmoittautumisesi: ' + ilta.otsikko + ' ' + arvot.pvm,
      'Hei ' + rivi[3] + ',\n\nvoit perua paikkasi iltaan ' + ilta.otsikko + ' ' + arvot.pvm + ' tästä linkistä:\n' +
      arvot.peruutus + '\n\nJos et pyytänyt tätä, voit jättää viestin huomiotta – ilmoittautumisesi on voimassa.');
  }
  return json_({ ok: true });
}

function peruutus_(tunniste) {
  const sh = sheet_('Ilmoittautumiset');
  const n = sh.getLastRow() - 1;
  const a = asetukset_();
  let teksti = 'Peruutuslinkkiä ei löytynyt. Ota yhteyttä: ' + (a['Vastausosoite'] || '');
  if (n > 0) {
    const rivit = sh.getRange(2, 1, n, 9).getValues();
    for (let i = 0; i < rivit.length; i++) {
      if (rivit[i][8] === tunniste) {
        if (rivit[i][6] !== 'Peruttu') {
          sh.getRange(i + 2, 7).setValue('Peruttu');
          if (a['Ilmoitus järjestäjille']) {
            lahetaPosti_(String(a['Ilmoitus järjestäjille']), 'Peruutus: ' + rivit[i][2],
              rivit[i][3] + ' <' + rivit[i][4] + '> perui paikkansa (' + pvmNaytto_(rivit[i][1]) + ').');
          }
        }
        teksti = String(a['Peruutus: kiitosteksti'] || 'Paikkasi on peruttu.');
        break;
      }
    }
  }
  const html = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:12vh auto;padding:0 24px;color:#1b3440;line-height:1.6;text-align:center;font-size:20px}' +
    'h1{color:#3e8aa3;font-weight:700;font-size:28px;margin-bottom:24px}</style></head><body><h1>circling.fi</h1><p>' +
    teksti.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</p></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('circling.fi').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------- Salainen osallistujasivu ----------

function osallistujasivu_(avain, valittu) {
  const a = asetukset_();
  const oikea = String(a['Osallistujasivun avain'] || '');
  const e = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  if (!oikea || avain !== oikea) {
    return HtmlService.createHtmlOutput('<p style="font-family:system-ui;margin:20vh auto;text-align:center">Ei pääsyä.</p>');
  }
  const nyt = new Date();
  const tulevat = illat_().filter(x => x.loppuu > nyt).sort((p, q) => p.alkaa - q.alkaa).slice(0, 6);
  const ilta = tulevat.find(x => x.id === valittu) || tulevat[0];
  const sh = sheet_('Ilmoittautumiset');
  const n = sh.getLastRow() - 1;
  const rivit = n > 0 ? sh.getRange(2, 1, n, 10).getValues() : [];
  const lista = ilta ? rivit.filter(r => r[1] instanceof Date && pvmAvain_(r[1]) === pvmAvain_(ilta.pvm)) : [];
  const mukana = lista.filter(r => r[6] !== 'Peruttu');
  const perutut = lista.filter(r => r[6] === 'Peruttu');
  const url = ScriptApp.getService().getUrl() + '?lista=' + encodeURIComponent(avain);

  const valinnat = tulevat.map(x =>
    `<a class="${x === ilta ? 'on' : ''}" href="${url}&ilta=${encodeURIComponent(x.id)}" target="_top">${e(pvmNaytto_(x.pvm).replace(/ \d{4}$/, ''))}</a>`).join('');
  const rivi = (r, i) => `<li><span class="nro">${i + 1}</span><div><b>${e(r[3])}</b>` +
    (r[5] ? `<div class="viesti">${e(r[5])}</div>` : '') + `</div></li>`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:system-ui,-apple-system,sans-serif;color:#1b3440;max-width:640px;margin:0 auto;padding:20px;line-height:1.5}
h1{color:#255a6b;font-size:1.5rem;margin:8px 0 2px}
.meta{color:#5c7480;margin-bottom:16px}
.valinnat{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}
.valinnat a{padding:6px 12px;border-radius:999px;border:1px solid #cadde3;text-decoration:none;color:#255a6b;font-size:.9rem}
.valinnat a.on{background:#3e8aa3;color:#fff;border-color:#3e8aa3}
.maara{font-size:2rem;font-weight:700;color:#3e8aa3}
ul{list-style:none;padding:0;margin:0}
li{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid #ebf2f4}
.nro{width:28px;height:28px;border-radius:50%;background:#ebf2f4;color:#255a6b;display:grid;place-items:center;font-size:.85rem;flex:none}
.pieni{color:#5c7480;font-size:.88rem}
.viesti{background:#fde3dd;border-radius:8px;padding:6px 10px;margin-top:6px;font-size:.92rem}
h2{font-size:1rem;color:#5c7480;margin-top:28px}
.peruttu b{text-decoration:line-through;color:#5c7480}
</style></head><body>
<div class="valinnat">${valinnat}</div>
${ilta ? `<h1>${e(ilta.otsikko)}</h1>
<div class="meta">${e(pvmNaytto_(ilta.pvm))} klo ${e(ilta.alku)}–${e(ilta.loppu)}</div>
<div class="maara">${mukana.length}${ilta.max ? ' / ' + ilta.max : ''}</div><div class="meta">ilmoittautunutta</div>
<ul>${mukana.map(rivi).join('') || '<li>Ei ilmoittautuneita vielä.</li>'}</ul>
${perutut.length ? `<h2>Peruneet (${perutut.length})</h2><ul class="peruttu">${perutut.map(rivi).join('')}</ul>` : ''}`
    : '<p>Ei tulevia iltoja.</p>'}
<p class="pieni" style="margin-top:28px">Päivitetty ${Utilities.formatDate(nyt, TZ, 'd.M. H.mm')}. Päivitä sivu nähdäksesi uusimmat.</p>
</body></html>`;
  return HtmlService.createHtmlOutput(html).setTitle('Osallistujat').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function naytaOsallistujasivu() {
  const avain = String(asetukset_()['Osallistujasivun avain'] || '');
  const url = ScriptApp.getService().getUrl() + '?lista=' + encodeURIComponent(avain);
  SpreadsheetApp.getUi().alert('Osallistujasivu (älä jaa julkisesti):\n\n' + url);
}

// ---------- Ajastetut toiminnot ----------

/** Lähettää muistutukset. Ajastus ajaa tämän tunnin välein. */
function muistutukset() {
  const a = asetukset_();
  const tuntia = Number(a['Muistutus tuntia ennen']) || 24;
  const nyt = new Date();
  const illat = illat_();
  const sh = sheet_('Ilmoittautumiset');
  const n = sh.getLastRow() - 1;
  if (n < 1) return;
  const rivit = sh.getRange(2, 1, n, 10).getValues();
  rivit.forEach((r, i) => {
    if (!(r[1] instanceof Date) || r[6] === 'Peruttu' || r[7] || r[9] !== true || !r[4]) return;
    const ilta = illat.find(x => pvmAvain_(x.pvm) === pvmAvain_(r[1]));
    if (!ilta) return;
    const jaljella = ilta.alkaa - nyt;
    if (jaljella > 0 && jaljella <= tuntia * 3600 * 1000) {
      const arvot = postinArvot_(ilta, r[3], r[8]);
      lahetaPosti_(r[4], tayta_(a['Muistutus: otsikko'], arvot), tayta_(a['Muistutus: teksti'], arvot));
      sh.getRange(i + 2, 8).setValue(new Date());
    }
  });
}

/** Tekee illoista kalenterimerkinnät ja pitää ne ajan tasalla. */
function synkronoiKalenteri() {
  const a = asetukset_();
  const kal = a['Kalenterin ID'] ? CalendarApp.getCalendarById(String(a['Kalenterin ID'])) : CalendarApp.getDefaultCalendar();
  if (!kal) throw new Error('Kalenteria ei löytynyt. Tarkista Asetukset-välilehden Kalenterin ID.');
  const sivu = String(a['Sivun osoite'] || '');
  // Osallistujalinkki lisätään vain omaan kalenteriin (ei julkiseen), koska linkki on salainen.
  const omaKalenteri = !a['Kalenterin ID'];
  const listaUrl = ScriptApp.getService().getUrl() + '?lista=' + encodeURIComponent(String(a['Osallistujasivun avain'] || ''));
  const sh = sheet_('Illat');
  illat_().forEach(x => {
    let tapahtuma = null;
    if (x.kalenteriId) { try { tapahtuma = kal.getEventById(x.kalenteriId); } catch (err) { tapahtuma = null; } }
    if (!x.nakyvissa) {
      if (tapahtuma) tapahtuma.deleteEvent();
      if (x.kalenteriId) sh.getRange(x.rivi, 10).setValue('');
      return;
    }
    let kuvaus = sivu ? 'Ilmoittaudu: ' + sivu : '';
    if (omaKalenteri && a['Osallistujasivun avain']) kuvaus += (kuvaus ? '\n\n' : '') + 'Osallistujat: ' + listaUrl + '&ilta=' + encodeURIComponent(x.id);
    if (tapahtuma) {
      tapahtuma.setTitle(x.otsikko);
      tapahtuma.setTime(x.alkaa, x.loppuu);
      tapahtuma.setLocation(x.paikka);
      tapahtuma.setDescription(kuvaus);
    } else {
      tapahtuma = kal.createEvent(x.otsikko, x.alkaa, x.loppuu, { location: x.paikka, description: kuvaus });
      sh.getRange(x.rivi, 10).setValue(tapahtuma.getId());
    }
  });
}

function ajastettu() {
  muistutukset();
  synkronoiKalenteri();
}

/** Aja tämä kerran: luo tunnin välein toimivan ajastuksen. */
function otaAjastuksetKayttoon() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'ajastettu') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('ajastettu').timeBased().everyHours(1).create();
  synkronoiKalenteri();
  SpreadsheetApp.getActive().toast('Ajastukset käytössä: muistutukset ja kalenteri päivittyvät tunnin välein.');
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Circling')
    .addItem('Näytä osallistujasivun linkki', 'naytaOsallistujasivu')
    .addItem('Päivitä kalenteri nyt', 'synkronoiKalenteri')
    .addItem('Lähetä erääntyneet muistutukset nyt', 'muistutukset')
    .addSeparator()
    .addItem('Ota ajastukset käyttöön', 'otaAjastuksetKayttoon')
    .addToUi();
}
