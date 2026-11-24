/* circling.fi – sivun toiminnot (ilmoittautuminen, videot, palautteet).
   Sivujen sisältö on valmiina HTML:ssä (build.js rakentaa sen tekstit.md:stä). */
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

// Vanhat #-linkit (esim. /#tulevat-illat) ohjataan uusille sivuille
(function(){
  const h = location.hash.slice(1);
  if(h && /^[a-z0-9-]+$/.test(h) && (location.pathname === "/" || location.pathname === "/index.html") && h !== "etusivu")
    location.replace("/" + h + "/");
})();

/* Ilmoittautumisjärjestelmän osoite (Apps Script, päättyy /exec) */
const API = "https://script.google.com/macros/s/AKfycbw_soiWMMAg7gSkyd8rVzcow8D1Kyx5x-6alziVkjKfvEJwHbowkCtbr3uc2hWIStLq8w/exec";

const KUUT = ["tammi","helmi","maalis","huhti","touko","kesä","heinä","elo","syys","loka","marras","joulu"];



/* ---------- Ilmoittautuminen ---------- */
const ILLAT = {};
const pad = n => String(n).padStart(2,"0");
function ajat(e){
  const [ah,am] = e.alku.split(/[.:]/), [lh,lm] = (e.loppu || e.alku).split(/[.:]/);
  const p = `${e.vuosi}${pad(e.kuukausi)}${pad(e.paiva)}`;
  return {alku:`${p}T${pad(ah)}${pad(am||0)}00`, loppu:`${p}T${pad(lh)}${pad(lm||0)}00`};
}
function kalenteriNapit(e){
  const t = ajat(e);
  const g = "https://calendar.google.com/calendar/render?action=TEMPLATE&text="+encodeURIComponent(e.otsikko)+
    "&dates="+t.alku+"/"+t.loppu+"&ctz=Europe/Helsinki&location="+encodeURIComponent(e.paikka);
  const es = s => String(s).replace(/([,;\\])/g,"\\$1");
  const ics = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//circling.fi//FI","BEGIN:VEVENT",
    "UID:"+e.id+"@circling.fi","DTSTAMP:"+new Date().toISOString().replace(/[-:]/g,"").slice(0,15)+"Z",
    "DTSTART;TZID=Europe/Helsinki:"+t.alku,"DTEND;TZID=Europe/Helsinki:"+t.loppu,
    "SUMMARY:"+es(e.otsikko),"LOCATION:"+es(e.paikka),"END:VEVENT","END:VCALENDAR"].join("\r\n");
  const url = URL.createObjectURL(new Blob([ics],{type:"text/calendar"}));
  return `<div style="margin-top:12px"><a class="nappi" href="${g}" target="_blank" rel="noopener">Lisää Google-kalenteriin</a>
    <a class="nappi2" href="${url}" download="circling-ilta.ics">Apple / Outlook</a></div>`;
}
function ilmoKortti(e){
  const luokka = e.tyyppi === "avoin" ? " avoin" : e.tyyppi === "joulu" ? " joulu" : "";
  const taynna = e.vapaana === 0;
  const tila = taynna ? "Täynnä" : (e.vapaana != null && e.vapaana <= 5 ? `${e.vapaana} paikkaa jäljellä` : "Ilmoittaudu");
  return `<div class="ilmo">
    <button class="ilta${luokka}" data-id="${esc(e.id)}" ${taynna ? "disabled" : ""} aria-expanded="false">
      <div class="pvm"><div class="d">${e.paiva}</div><div class="m">${KUUT[e.kuukausi-1]}</div></div>
      <div><h3>${esc(e.otsikko)}</h3><div class="meta">${esc(e.viikonpaiva)} klo ${esc(e.alku)}${e.loppu ? "–"+esc(e.loppu) : ""}</div></div>
      <span class="tila${taynna ? " taynna" : ""}">${esc(tila)}</span>
    </button>
    <form class="lomake" data-id="${esc(e.id)}" novalidate>
      <p class="paikka">${esc(e.paikka)}</p>
      <label>Nimi (etunimi riittää)<input name="nimi" autocomplete="given-name" required maxlength="100"></label>
      <label>Sähköposti (vapaaehtoinen)<input name="email" type="email" autocomplete="email" maxlength="200"></label>
      <label>Viesti ohjaajille (vapaaehtoinen)<textarea name="viesti" maxlength="1000"></textarea></label>
      <label class="valinta"><input type="checkbox" name="muistutus" checked> Lähetä minulle muistutus päivää ennen (vaatii sähköpostin)</label>
      <div class="ansa" aria-hidden="true"><label>Älä täytä<input name="sivusto" tabindex="-1" autocomplete="off"></label></div>
      <button type="submit" class="nappi">Ilmoittaudu iltaan</button>
      <p class="pieni">Jos annat sähköpostin, saat vahvistuksen ja voit perua paikkasi viestin linkistä. Ilman sähköpostia peruutukset: WhatsApp tai info@circling.fi.</p>
      <div class="tulos"></div>
    </form>
  </div>`;
}
function nayta2(el, ok, teksti){ el.innerHTML = `<div class="viesti ${ok ? "ok" : "virhe"}">${esc(teksti)}</div>`; }
async function laheta(ev){
  ev.preventDefault();
  const f = ev.target, tulos = f.querySelector(".tulos"), nappi = f.querySelector("button[type=submit]");
  const data = Object.fromEntries(new FormData(f)); data.ilta = f.dataset.id; data.muistutus = f.muistutus.checked;
  if(!data.nimi.trim()) return nayta2(tulos, false, "Kirjoita nimesi.");
  if(data.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) return nayta2(tulos, false, "Tarkista sähköpostiosoite.");
  nappi.disabled = true; nappi.textContent = "Lähetetään…"; tulos.innerHTML = "";
  try{
    const r = await fetch(API, {method:"POST", headers:{"Content-Type":"text/plain;charset=utf-8"}, body:JSON.stringify(data)});
    const v = await r.json();
    if(v.ok){
      f.querySelectorAll("label, button[type=submit], .pieni").forEach(x => x.style.display = "none");
      nayta2(tulos, true, v.jo ? "Olet jo ilmoittautunut tähän iltaan. Tervetuloa!" :
        `Kiitos, ${data.nimi.trim().split(" ")[0]}! Ilmoittautuminen on vastaanotettu${data.email.trim() ? ", ja vahvistus on matkalla sähköpostiisi" : ""}.`);
      if(v.jo){
        tulos.insertAdjacentHTML("beforeend", '<p class="pieni"><a href="#" class="peru-linkki">Peru ilmoittautuminen</a></p>');
        tulos.querySelector(".peru-linkki").addEventListener("click", async e2 => {
          e2.preventDefault();
          const p = e2.target.parentElement; p.textContent = "Lähetetään…";
          try{
            const r2 = await fetch(API, {method:"POST", headers:{"Content-Type":"text/plain;charset=utf-8"},
              body:JSON.stringify({toiminto:"peru", ilta:data.ilta, email:data.email})});
            const v2 = await r2.json();
            p.textContent = v2.ok ? "Lähetimme peruutuslinkin sähköpostiisi. Paikka vapautuu, kun klikkaat linkkiä." : (v2.virhe || "Jokin meni pieleen.");
          }catch(err){ p.textContent = "Yhteys ei toiminut. Peru paikkasi viestillä: info@circling.fi"; }
        });
      }
      if(ILLAT[data.ilta]) tulos.insertAdjacentHTML("beforeend", kalenteriNapit(ILLAT[data.ilta]));
    } else {
      nayta2(tulos, false, v.virhe || "Jokin meni pieleen. Yritä uudelleen.");
      nappi.disabled = false; nappi.textContent = "Ilmoittaudu iltaan";
    }
  }catch(err){
    nayta2(tulos, false, "Yhteys ei toiminut. Yritä hetken päästä uudelleen tai kirjoita: info@circling.fi");
    nappi.disabled = false; nappi.textContent = "Ilmoittaudu iltaan";
  }
}
async function lataaIllat(){
  const paikat = document.querySelectorAll(".illat-api");
  if(!API || !paikat.length) return;
  let illat;
  try{ const d = await (await fetch(API)).json(); if(!d.ok) return; illat = d.illat; }
  catch(e){ return; }  // jos haku ei onnistu, tekstit.md:n illat jäävät näkyviin
  illat.forEach(e => ILLAT[e.id] = e);
  lisaaTapahtumadata(illat);
  paikat.forEach(p => {
    const lista = p.dataset.max ? illat.slice(0, +p.dataset.max) : illat;
    p.innerHTML = lista.length ? `<div class="illat">${lista.map(ilmoKortti).join("")}</div>` : `<p class="ei-iltoja">Uusia iltoja tulossa pian.</p>`;
    p.querySelectorAll("button.ilta").forEach(b => b.addEventListener("click", () => {
      const f = b.nextElementSibling, auki = !f.classList.contains("auki");
      document.querySelectorAll(".lomake.auki").forEach(x => { x.classList.remove("auki"); x.previousElementSibling.setAttribute("aria-expanded","false"); });
      if(auki){ f.classList.add("auki"); b.setAttribute("aria-expanded","true"); f.querySelector("input").focus(); }
    }));
    p.querySelectorAll("form.lomake").forEach(f => f.addEventListener("submit", laheta));
  });
}


/* Tapahtumatiedot Googlelle myös illoista, jotka on lisätty Sheetiin julkaisun jälkeen */
function lisaaTapahtumadata(illat){
  if(!illat.length) return;
  const iso = (e,a) => { const [h,m]=String(a||"18.00").split(/[.:]/); const kesa=e.kuukausi>3&&e.kuukausi<11;
    return `${e.vuosi}-${String(e.kuukausi).padStart(2,"0")}-${String(e.paiva).padStart(2,"0")}T${String(h).padStart(2,"0")}:${String(m||0).padStart(2,"0")}:00${kesa?"+03:00":"+02:00"}`; };
  const s=document.createElement("script"); s.type="application/ld+json";
  s.textContent=JSON.stringify(illat.map(e=>({"@context":"https://schema.org","@type":"Event",name:e.otsikko,
    startDate:iso(e,e.alku),endDate:iso(e,e.loppu||e.alku),eventAttendanceMode:"https://schema.org/OfflineEventAttendanceMode",
    eventStatus:"https://schema.org/EventScheduled",location:{"@type":"Place",name:"Galleria Sitruunapuu",
    address:{"@type":"PostalAddress",streetAddress:"Sammatintie 2",postalCode:"00550",addressLocality:"Helsinki",addressCountry:"FI"}}})));
  document.head.appendChild(s);
}

/* ---------- Videot, palautteet, linkit ---------- */
document.querySelectorAll("main ul").forEach(ul=>{
  const lis=[...ul.children];
  if(lis.length && lis.every(li=>/youtu\.?be/.test(li.querySelector("a")?.href||""))){
    ul.classList.add("videot");
    lis.forEach(li=>{
      const a=li.querySelector("a"); const m=a.href.match(/(?:youtu\.be\/|v=)([\w-]{11})/);
      if(!m) return;
      li.className="video";
      li.innerHTML=`<a href="https://youtu.be/${m[1]}"><span class="peukalo" style="background-image:url(https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg)"><span class="play">▶</span></span><span class="vnimi">${esc(a.textContent.trim())}</span></a>`;
    });
  }
  if(lis.length && lis.every(li=>/^\s*[”"“]/.test(li.textContent))) ul.classList.add("palautteet");
});
document.querySelectorAll('a[href^="http"]').forEach(a=>{a.target="_blank";a.rel="noopener"});
document.querySelectorAll(".video a").forEach(a=>{
  a.addEventListener("click", ev=>{
    ev.preventDefault();
    const id=a.href.split("/").pop();
    a.querySelector(".peukalo").outerHTML=`<div class="upotus"><iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1" title="${esc(a.textContent)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
    a.style.cursor="default";
  }, {once:true});
});

/* ---------- Puhelimella slogan ja pääotsikko yhdelle riville ---------- */
function sovita(){
  document.querySelectorAll(".sivu .slogan, .sivu h1").forEach(el=>{
    el.style.fontSize=""; el.style.whiteSpace="";
    if(innerWidth>760) return;
    const tila=el.clientWidth; el.style.whiteSpace="nowrap";
    let koko=parseFloat(getComputedStyle(el).fontSize);
    while(el.scrollWidth>tila && koko>10){ koko-=0.5; el.style.fontSize=koko+"px"; }
  });
}
addEventListener("resize", sovita);
if(document.fonts) document.fonts.ready.then(sovita);
sovita();

lataaIllat();
