/* ===== Star Party — "Tonight" recommender =====
   Given a location + date, computes which catalog objects are up during the
   evening, ranks them for a beginner scope, and flags faint ones the Moon
   washes out. Uses astronomy-engine (window.Astronomy) + window.SP_CATALOG,
   and window.SP for persistence / library integration (exposed by app.js).
*/
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const el = (t, p = {}, ...k) => { const n = Object.assign(document.createElement(t), p); for (const c of k) n.append(c); return n; };
  const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const compass = (az) => COMPASS[Math.round(az / 22.5) % 16];
  const timeStr = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  // ---------- core computation ----------
  function recommend(lat, lon, dateObj) {
    const A = window.Astronomy;
    const obs = new A.Observer(lat, lon, 100);

    // Start searching from local noon of the chosen day.
    const noon = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), 12, 0, 0);
    const noonT = A.MakeTime(noon);
    const sunset = A.SearchRiseSet(A.Body.Sun, obs, -1, noonT, 1);
    if (!sunset) return { error: 'No sunset on this date at this location.' };
    let dusk = A.SearchAltitude(A.Body.Sun, obs, -1, noonT, 1, -18);

    // Observing window: sunset → +5 hours (a realistic public-party evening).
    const winStart = sunset.date.getTime();
    const winEnd = winStart + 5 * 3600 * 1000;
    const STEP = 15 * 60 * 1000;

    const moonIll = A.Illumination(A.Body.Moon, A.MakeTime(new Date((winStart + winEnd) / 2))).phase_fraction;

    // Track each object's highest point during the window.
    const track = window.SP_CATALOG.map((o) => ({ o, maxAlt: -90, bestT: winStart, az: 0 }));
    for (let t = winStart; t <= winEnd; t += STEP) {
      const time = A.MakeTime(new Date(t));
      for (const r of track) {
        let h;
        if (r.o.kind === 'planet') {
          const eq = A.Equator(A.Body[r.o.body], time, obs, true, true);
          h = A.Horizon(time, obs, eq.ra, eq.dec, 'normal');
        } else {
          h = A.Horizon(time, obs, r.o.ra, r.o.dec, 'normal');
        }
        if (h.altitude > r.maxAlt) { r.maxAlt = h.altitude; r.bestT = t; r.az = h.azimuth; }
      }
    }

    const moonTrack = track.find((r) => r.o.id === 'moon');
    const moonUp = moonTrack && moonTrack.maxAlt > 0;
    const moonBright = moonUp && moonIll > 0.55;

    const items = [], washedOut = [];
    for (const r of track) {
      if (r.maxAlt < 12) continue; // effectively not observable
      if (moonBright && r.o.moonSensitive) { washedOut.push(r.o.short || r.o.name); continue; }
      const flags = [];
      if (r.maxAlt < 20) flags.push('low — catch it early');
      // Planets are headline beginner targets, so boost them even when low.
      const score = r.o.showpiece * 20 + r.maxAlt * 0.5 + (r.o.kind === 'planet' ? 25 : 0);
      items.push({
        o: r.o,
        alt: Math.round(r.maxAlt),
        dir: compass(r.az),
        best: timeStr(r.bestT),
        flags,
        quality: (r.maxAlt >= 40 && r.o.showpiece >= 4) ? 'great' : (r.maxAlt < 20 ? 'low' : 'good'),
        score,
      });
    }
    items.sort((a, b) => b.score - a.score);
    return {
      sunsetMs: winStart,
      duskMs: dusk ? dusk.date.getTime() : null,
      moonIll, moonUp, moonBright,
      items: items.slice(0, 12),
      washedOut,
    };
  }

  // ---------- location handling ----------
  let curLoc = null; // {lat, lon, label}

  function parseLatLon(s) {
    const m = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) return null;
    return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
  }

  async function geocode(query) {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(query);
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('Lookup failed (' + res.status + ')');
    const data = await res.json();
    if (!data.length) throw new Error('No place found for “' + query + '”');
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), label: data[0].display_name.split(',').slice(0, 3).join(',') };
  }

  // Resolve whatever is in the input box to coordinates.
  async function resolveLocation() {
    const raw = $('#loc-input').value.trim();
    if (!raw) throw new Error('Enter a place name or coordinates first.');
    const ll = parseLatLon(raw);
    if (ll) { curLoc = { ...ll, label: raw }; return curLoc; }
    const g = await geocode(raw);
    curLoc = g;
    $('#loc-input').value = g.label;
    return curLoc;
  }

  // ---------- favorites ----------
  async function loadFavs() { return (await window.SP.getSetting('places', [])) || []; }
  async function renderFavs() {
    const wrap = $('#loc-favs');
    wrap.innerHTML = '';
    const favs = await loadFavs();
    for (const f of favs) {
      const chip = el('button', { className: 'fav-chip', type: 'button', textContent: f.label });
      chip.onclick = () => { curLoc = f; $('#loc-input').value = f.label; };
      const x = el('span', { className: 'fav-x', textContent: '×', title: 'remove' });
      x.onclick = async (e) => { e.stopPropagation(); const list = (await loadFavs()).filter((p) => !(p.lat === f.lat && p.lon === f.lon)); await window.SP.setSetting('places', list); renderFavs(); };
      chip.append(x);
      wrap.append(chip);
    }
  }
  async function saveFav() {
    try {
      const loc = await resolveLocation();
      const favs = await loadFavs();
      if (!favs.some((p) => p.label === loc.label)) { favs.push({ ...loc }); await window.SP.setSetting('places', favs); renderFavs(); }
      setStatus('Saved “' + loc.label + '”.');
    } catch (e) { setStatus(e.message, true); }
  }

  function setStatus(msg, isErr) {
    const s = $('#tn-status');
    s.textContent = msg || '';
    s.classList.toggle('err', !!isErr);
  }

  // ---------- run + render ----------
  async function run() {
    if (!window.Astronomy) { setStatus('Sky engine not loaded.', true); return; }
    setStatus('Calculating…');
    $('#tn-results').innerHTML = '';
    $('#tn-summary').innerHTML = '';
    $('#tn-washed').textContent = '';
    let loc;
    try { loc = await resolveLocation(); } catch (e) { setStatus(e.message, true); return; }

    const dval = $('#tn-date').value;
    const [y, m, d] = dval.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);

    let r;
    try { r = recommend(loc.lat, loc.lon, dateObj); } catch (e) { setStatus('Calculation error: ' + e.message, true); return; }
    if (r.error) { setStatus(r.error, true); return; }
    setStatus('');

    await window.SP.setSetting('lastLoc', loc);

    // summary
    const moonPct = Math.round(r.moonIll * 100);
    const dateLabel = dateObj.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const sum = $('#tn-summary');
    sum.append(
      el('div', { className: 'tn-loc', textContent: '📍 ' + loc.label }),
      el('div', { className: 'tn-when', textContent:
        dateLabel + ' · sunset ' + timeStr(r.sunsetMs) + (r.duskMs ? ' · dark by ' + timeStr(r.duskMs) : '') }),
      el('div', { className: 'tn-moon', textContent:
        '🌙 Moon ' + moonPct + '% ' + (r.moonBright ? '(bright — faint objects hidden)' : (r.moonUp ? '(up)' : '(below horizon)')) })
    );

    // results
    const list = $('#tn-results');
    if (!r.items.length) { list.append(el('p', { className: 'empty', textContent: 'Nothing well-placed in this window. Try a later date or time of year.' })); }
    for (const it of r.items) list.append(card(it));

    if (r.washedOut.length) {
      $('#tn-washed').textContent = 'Hidden by tonight’s bright Moon: ' + r.washedOut.join(', ') + '.';
    }
  }

  function card(it) {
    const o = it.o;
    const c = el('div', { className: 'tn-card q-' + it.quality });
    const head = el('div', { className: 'tn-head' });
    head.append(
      el('span', { className: 'tn-name', textContent: o.name }),
      el('span', { className: 'tn-pos', textContent: it.alt + '° ' + it.dir })
    );
    c.append(head);
    c.append(el('div', { className: 'tn-meta', textContent:
      [o.type, o.constellation].filter(Boolean).join(' · ') + ' · best ~' + it.best }));
    const tag = it.quality === 'great' ? '⭐ excellent tonight' : (it.flags.length ? '⚠ ' + it.flags.join(', ') : '');
    if (tag) c.append(el('div', { className: 'tn-tag', textContent: tag }));
    if (o.look) c.append(el('div', { className: 'tn-look', textContent: o.look }));

    const actions = el('div', { className: 'tn-actions' });
    const addBtn = el('button', { className: 'btn small', type: 'button', textContent: '＋ Library' });
    addBtn.onclick = async () => { await window.SP.addCatalogToLibrary(o); addBtn.textContent = '✓ Added'; addBtn.disabled = true; };
    const nowBtn = el('button', { className: 'btn small ghost', type: 'button', textContent: '◉ Now Viewing' });
    nowBtn.onclick = async () => { const id = await window.SP.addCatalogToLibrary(o); await window.SP.setActive(id); setStatus('“' + o.name + '” is now showing.'); };
    actions.append(addBtn, nowBtn);
    c.append(actions);
    return c;
  }

  // ---------- init ----------
  async function init() {
    // default date = today
    const t = new Date();
    $('#tn-date').value = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');

    const last = await window.SP.getSetting('lastLoc', null);
    if (last) { curLoc = last; $('#loc-input').value = last.label || (last.lat + ', ' + last.lon); }
    await renderFavs();

    $('#tn-go').onclick = run;
    $('#loc-save').onclick = saveFav;
    $('#loc-gps').onclick = () => {
      if (!navigator.geolocation) { setStatus('GPS not available on this device.', true); return; }
      setStatus('Getting GPS…');
      navigator.geolocation.getCurrentPosition(
        (pos) => { curLoc = { lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'My location (GPS)' }; $('#loc-input').value = curLoc.lat.toFixed(4) + ', ' + curLoc.lon.toFixed(4); setStatus('Got your location.'); },
        (err) => setStatus('GPS failed: ' + err.message, true),
        { enableHighAccuracy: false, timeout: 10000 }
      );
    };
    $('#loc-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  }

  window.SP_TONIGHT = { recommend }; // exposed for reuse/testing

  if (window.SP && window.SP.ready) init();
  else window.addEventListener('sp-ready', init, { once: true });
})();
