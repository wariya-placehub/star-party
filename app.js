/* ===== Star Party — app logic (vanilla JS, no dependencies) ===== */
(() => {
  'use strict';

  // ---------- tiny DOM helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    for (const k of kids) n.append(k);
    return n;
  };
  const uid = () => 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);

  // ---------- IndexedDB layer ----------
  const DB_NAME = 'starparty';
  const DB_VER = 1;
  let _db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('objects')) db.createObjectStore('objects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = _db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
      t.oncomplete = () => resolve(req ? req.result : undefined);
    });
  }
  const getAll = (store) => tx(store, 'readonly', (s) => s.getAll());
  const get = (store, key) => tx(store, 'readonly', (s) => s.get(key));
  const put = (store, val) => tx(store, 'readwrite', (s) => s.put(val));
  const del = (store, key) => tx(store, 'readwrite', (s) => s.delete(key));

  const setSetting = (key, value) => put('settings', { key, value });
  async function getSetting(key, dflt) {
    const r = await get('settings', key);
    return r ? r.value : dflt;
  }

  // ---------- app state ----------
  const state = {
    objects: [],
    photos: [],
    activeId: null,
    backStack: [],
  };

  // ---------- navigation ----------
  function show(view) {
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    // Tab bar highlights the nearest top-level section (detail/edit map to library, etc.)
    const top = ({ detail: 'library', edit: 'library', photoedit: 'photos' })[view] || view;
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === top));
    document.querySelector('#view-' + view)?.scrollTo(0, 0);
    if (view === 'now') requestAnimationFrame(fitNowName);
  }

  $('#tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) show(tab.dataset.view);
  });
  $$('[data-back]').forEach((b) => b.addEventListener('click', () => show(b.dataset.back)));

  // ---------- NOW VIEWING ----------
  // Grow the name to the largest font size that still fits the screen.
  function fitNowName() {
    const wrap = $('#now-wrap'), node = $('#now-name');
    const maxW = wrap.clientWidth, maxH = wrap.clientHeight;
    if (!maxW || !maxH) return; // not visible yet
    let lo = 16, hi = maxH;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      node.style.fontSize = mid + 'px';
      if (node.scrollWidth <= maxW && node.scrollHeight <= maxH) lo = mid; else hi = mid;
    }
    node.style.fontSize = Math.floor(lo) + 'px';
  }

  async function renderNow() {
    const obj = state.objects.find((o) => o.id === state.activeId);
    const nameEl = $('#now-name'), wrap = $('#now-wrap'), pbtn = $('#now-photos');
    nameEl.textContent = obj ? obj.name : '—';
    wrap.onclick = obj ? () => openDetail(obj.id) : () => show('library');
    const linked = obj ? state.photos.filter((p) => p.objectId === obj.id) : [];
    if (linked.length) {
      pbtn.hidden = false;
      pbtn.textContent = '📷 ' + linked.length + (linked.length > 1 ? ' photos' : ' photo');
      pbtn.onclick = () => openGallery(obj.id, null, 'now');
    } else {
      pbtn.hidden = true;
    }
    fitNowName();
  }

  // Refit when the window/orientation changes and the Now screen is showing.
  // After rotation some phones briefly report stale dimensions, so refit a few times.
  function refitSoon() {
    if (!$('#view-now').classList.contains('active')) return;
    fitNowName();
    requestAnimationFrame(fitNowName);
    setTimeout(fitNowName, 250);
  }
  window.addEventListener('resize', refitSoon);
  window.addEventListener('orientationchange', refitSoon);

  // Brightness dimmer
  const dimmer = $('#dimmer'), dimSlider = $('#dim-slider');
  function applyDim(v) { dimmer.style.opacity = String((Number(v) || 0) / 100); }
  dimSlider.addEventListener('input', () => { applyDim(dimSlider.value); });
  dimSlider.addEventListener('change', () => { setSetting('dim', dimSlider.value); });

  // ---------- LIBRARY ----------
  function renderLibrary() {
    const list = $('#object-list');
    list.innerHTML = '';
    const sorted = [...state.objects].sort((a, b) => a.name.localeCompare(b.name));
    $('#library-empty').hidden = sorted.length > 0;
    for (const o of sorted) {
      const item = el('div', { className: 'list-item' + (o.id === state.activeId ? ' is-now' : '') });
      item.append(
        el('div', { className: 'li-name', textContent: o.name }),
        el('div', { className: 'li-meta', textContent: [o.type, o.constellation].filter(Boolean).join(' · ') || '—' })
      );
      item.onclick = () => openDetail(o.id);
      list.append(item);
    }
  }

  // ---------- DETAIL ----------
  let currentDetailId = null;
  async function openDetail(id) {
    const o = state.objects.find((x) => x.id === id);
    if (!o) return;
    currentDetailId = id;
    const body = $('#detail-body');
    body.innerHTML = '';

    body.append(el('h2', { textContent: o.name }));

    const badges = el('div', { className: 'badges' });
    [['', o.type], ['', o.constellation], ['Mag ', o.magnitude], ['', o.distance]]
      .filter(([, v]) => v)
      .forEach(([p, v]) => badges.append(el('span', { className: 'badge', textContent: p + v })));
    if (badges.children.length) body.append(badges);

    const section = (title, text) => {
      if (!text) return;
      body.append(
        el('div', {},
          el('div', { className: 'section-title', textContent: title }),
          el('div', { className: 'section-body', textContent: text })
        )
      );
    };
    section('In the eyepiece', o.eyepiece);
    section('Talking points', o.talking);

    // linked photos
    const linked = state.photos.filter((p) => p.objectId === o.id);
    if (linked.length) {
      const wrap = el('div', {});
      wrap.append(el('div', { className: 'section-title', textContent: 'Photos' }));
      const thumbs = el('div', { className: 'photo-thumbs' });
      for (const p of linked) {
        const img = el('img', { src: URL.createObjectURL(p.blob) });
        img.onclick = () => openGallery(o.id, p.id, 'detail');
        thumbs.append(img);
      }
      wrap.append(thumbs);
      body.append(wrap);
    }

    $('#detail-setnow-btn').textContent = (o.id === state.activeId) ? '✓ Currently “Now Viewing”' : 'Set as “Now Viewing”';
    show('detail');
  }

  $('#detail-edit-btn').onclick = () => openEdit(currentDetailId);
  $('#detail-setnow-btn').onclick = async () => {
    state.activeId = currentDetailId;
    await setSetting('activeId', currentDetailId);
    await renderNow();
    renderLibrary();
    show('now');
  };

  // ---------- EDIT ----------
  function openEdit(id) {
    const o = id ? state.objects.find((x) => x.id === id) : null;
    $('#f-id').value = o ? o.id : '';
    $('#f-name').value = o?.name || '';
    $('#f-type').value = o?.type || '';
    $('#f-constellation').value = o?.constellation || '';
    $('#f-magnitude').value = o?.magnitude || '';
    $('#f-distance').value = o?.distance || '';
    $('#f-eyepiece').value = o?.eyepiece || '';
    $('#f-talking').value = o?.talking || '';
    $('#edit-delete-btn').hidden = !o;
    show('edit');
    setTimeout(() => $('#f-name').focus(), 50);
  }

  $('#add-object-btn').onclick = () => openEdit(null);

  $('#edit-save-btn').onclick = async () => {
    const name = $('#f-name').value.trim();
    if (!name) { $('#f-name').focus(); return; }
    const id = $('#f-id').value || uid();
    const existing = state.objects.find((o) => o.id === id);
    const obj = {
      id,
      name,
      type: $('#f-type').value.trim(),
      constellation: $('#f-constellation').value.trim(),
      magnitude: $('#f-magnitude').value.trim(),
      distance: $('#f-distance').value.trim(),
      eyepiece: $('#f-eyepiece').value.trim(),
      talking: $('#f-talking').value.trim(),
      createdAt: existing?.createdAt || Date.now(),
    };
    await put('objects', obj);
    await reloadObjects();
    openDetail(id);
  };

  $('#edit-delete-btn').onclick = async () => {
    const id = $('#f-id').value;
    if (!id) return;
    const o = state.objects.find((x) => x.id === id);
    if (!confirm('Delete “' + (o?.name || 'this object') + '”? This cannot be undone.')) return;
    await del('objects', id);
    if (state.activeId === id) { state.activeId = null; await setSetting('activeId', null); }
    await reloadObjects();
    await renderNow();
    show('library');
  };

  // ---------- PHOTOS ----------
  function renderPhotos() {
    const grid = $('#photo-grid');
    grid.innerHTML = '';
    const sorted = [...state.photos].sort((a, b) => b.createdAt - a.createdAt);
    $('#photos-empty').hidden = sorted.length > 0;
    for (const p of sorted) {
      const card = el('div', { className: 'photo-card' });
      const img = el('img', { src: URL.createObjectURL(p.blob), alt: p.title || 'photo' });
      card.append(img, el('div', { className: 'pc-title', textContent: p.title || 'Untitled' }));
      card.onclick = () => openPhotoEditor(p.id);
      grid.append(card);
    }
  }

  // Downscale big phone photos so storage stays reasonable.
  function fileToBlob(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const MAX = 1600;
        let { width: w, height: h } = img;
        if (Math.max(w, h) > MAX) {
          const s = MAX / Math.max(w, h);
          w = Math.round(w * s); h = Math.round(h * s);
        }
        const c = el('canvas', { width: w, height: h });
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        c.toBlob((b) => b ? resolve(b) : reject(new Error('encode failed')), 'image/jpeg', 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load failed')); };
      img.src = url;
    });
  }

  $('#photo-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    let firstId = null;
    for (const file of files) {
      try {
        const blob = await fileToBlob(file);
        const photo = { id: uid(), title: '', objectId: '', blob, markers: [], createdAt: Date.now() };
        await put('photos', photo);
        if (!firstId) firstId = photo.id;
      } catch (err) {
        alert('Could not load "' + (file.name || 'image') + '": ' + err.message);
      }
    }
    await reloadPhotos();
    // One photo → jump straight to annotating it; several → show the grid.
    if (files.length === 1 && firstId) openPhotoEditor(firstId);
    else show('photos');
  });

  // ---------- PHOTO EDITOR ----------
  let currentPhoto = null;
  let curImgURL = null;

  function buildLinkOptions(selectedId) {
    const sel = $('#photo-link');
    sel.innerHTML = '';
    sel.append(el('option', { value: '', textContent: '— none —' }));
    for (const o of [...state.objects].sort((a, b) => a.name.localeCompare(b.name))) {
      sel.append(el('option', { value: o.id, textContent: o.name, selected: o.id === selectedId }));
    }
  }

  function openPhotoEditor(id) {
    const p = state.photos.find((x) => x.id === id);
    if (!p) return;
    currentPhoto = JSON.parse(JSON.stringify({ ...p, blob: null })); // shallow editable copy of meta
    currentPhoto.blob = p.blob;
    if (curImgURL) URL.revokeObjectURL(curImgURL);
    curImgURL = URL.createObjectURL(p.blob);
    $('#photo-img').src = curImgURL;
    $('#photo-title').value = p.title || '';
    buildLinkOptions(p.objectId || '');
    renderMarkers();
    show('photoedit');
  }

  // Shared marker painter (editable in the editor, read-only in the gallery).
  function paintMarkers(layer, markers, onClick) {
    layer.innerHTML = '';
    (markers || []).forEach((m, i) => {
      const node = el('div', { className: 'marker' });
      node.style.left = (m.x * 100) + '%';
      node.style.top = (m.y * 100) + '%';
      node.append(el('div', { className: 'dot' }));
      if (m.label) node.append(el('div', { className: 'mlabel', textContent: m.label }));
      if (onClick) node.onclick = (ev) => { ev.stopPropagation(); onClick(i); };
      layer.append(node);
    });
  }
  function renderMarkers() { paintMarkers($('#marker-layer'), currentPhoto.markers, editMarker); }

  $('#photo-stage').addEventListener('click', (e) => {
    if (e.target.closest('.marker')) return;
    const rect = $('#photo-img').getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    promptLabel({ title: 'Label this point', value: '', allowRemove: false }, (label, removed) => {
      if (label == null) return;
      currentPhoto.markers.push({ x, y, label: label.trim() });
      renderMarkers();
      savePhotoMeta();
    });
  });

  function editMarker(i) {
    const m = currentPhoto.markers[i];
    promptLabel({ title: 'Edit pointer', value: m.label, allowRemove: true }, (label, removed) => {
      if (removed) { currentPhoto.markers.splice(i, 1); }
      else if (label == null) { return; }
      else { m.label = label.trim(); }
      renderMarkers();
      savePhotoMeta();
    });
  }

  async function savePhotoMeta() {
    currentPhoto.title = $('#photo-title').value.trim();
    currentPhoto.objectId = $('#photo-link').value;
    const full = { ...currentPhoto };
    await put('photos', full);
    await reloadPhotos();
  }
  $('#photo-title').addEventListener('change', savePhotoMeta);
  $('#photo-link').addEventListener('change', savePhotoMeta);

  $('#photo-delete-btn').onclick = async () => {
    if (!currentPhoto) return;
    if (!confirm('Delete this photo?')) return;
    await del('photos', currentPhoto.id);
    await reloadPhotos();
    show('photos');
  };

  // ---------- photo gallery (swipeable viewer for an object's photos) ----------
  let gallery = { photos: [], idx: 0, origin: 'now' };
  let gvURL = null;

  function openGallery(objectId, startPhotoId, origin) {
    const photos = state.photos.filter((p) => p.objectId === objectId).sort((a, b) => a.createdAt - b.createdAt);
    if (!photos.length) return;
    gallery.photos = photos;
    gallery.idx = startPhotoId ? Math.max(0, photos.findIndex((p) => p.id === startPhotoId)) : 0;
    gallery.origin = origin || 'now';
    renderGallery();
    show('photoview');
  }

  function renderGallery() {
    const p = gallery.photos[gallery.idx];
    if (!p) return;
    if (gvURL) URL.revokeObjectURL(gvURL);
    gvURL = URL.createObjectURL(p.blob);
    const img = $('#gv-img');
    const paint = () => paintMarkers($('#gv-markers'), p.markers);
    img.onload = paint;
    img.src = gvURL;
    paint();
    $('#gv-title').textContent = p.title || 'Untitled';
    $('#gv-counter').textContent = (gallery.idx + 1) + ' / ' + gallery.photos.length;
    const dots = $('#gv-dots');
    dots.innerHTML = '';
    gallery.photos.forEach((_, i) => dots.append(el('span', { className: 'gv-dot' + (i === gallery.idx ? ' on' : '') })));
    const multi = gallery.photos.length > 1;
    $('#gv-prev').hidden = !multi;
    $('#gv-next').hidden = !multi;
  }

  function galleryGo(delta) {
    const n = gallery.photos.length;
    if (n < 2) return;
    gallery.idx = (gallery.idx + delta + n) % n;
    renderGallery();
  }

  $('#gv-prev').onclick = () => galleryGo(-1);
  $('#gv-next').onclick = () => galleryGo(1);
  $('#gv-back').onclick = () => show(gallery.origin);
  $('#gv-edit').onclick = () => { const p = gallery.photos[gallery.idx]; if (p) openPhotoEditor(p.id); };
  (function () {
    let x0 = null;
    const st = $('#gv-stage');
    st.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    st.addEventListener('touchend', (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 40) galleryGo(dx < 0 ? 1 : -1);
      x0 = null;
    });
  })();

  // ---------- label modal ----------
  let labelCb = null;
  function promptLabel({ title, value, allowRemove }, cb) {
    labelCb = cb;
    $('#label-modal-title').textContent = title;
    const input = $('#label-input');
    input.value = value || '';
    $('#label-remove').hidden = !allowRemove;
    $('#label-modal').hidden = false;
    setTimeout(() => input.focus(), 50);
  }
  function closeLabel() { $('#label-modal').hidden = true; labelCb = null; }
  $('#label-ok').onclick = () => { const cb = labelCb; const v = $('#label-input').value; closeLabel(); cb && cb(v, false); };
  $('#label-cancel').onclick = () => { closeLabel(); };
  $('#label-remove').onclick = () => { const cb = labelCb; closeLabel(); cb && cb(null, true); };
  $('#label-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#label-ok').click(); });

  // ---------- data loading ----------
  async function reloadObjects() { state.objects = await getAll('objects'); renderLibrary(); buildLinkOptionsSafe(); }
  async function reloadPhotos() { state.photos = await getAll('photos'); renderPhotos(); renderNow(); }
  function buildLinkOptionsSafe() { if (currentPhoto) buildLinkOptions(currentPhoto.objectId || ''); }

  // ---------- integration API for the Tonight recommender (tonight.js) ----------
  async function addCatalogToLibrary(c) {
    const existing = state.objects.find((o) => o.name === c.name);
    if (existing) return existing.id;
    const obj = {
      id: uid(), name: c.name,
      type: c.type || '', constellation: c.constellation || '',
      magnitude: (c.mag != null ? String(c.mag) : ''), distance: '',
      eyepiece: c.look || '', talking: c.facts || '', createdAt: Date.now(),
    };
    await put('objects', obj);
    await reloadObjects();
    return obj.id;
  }
  async function setActive(id) {
    state.activeId = id;
    await setSetting('activeId', id);
    await renderNow();
    renderLibrary();
  }
  window.SP = { ready: false, getSetting, setSetting, addCatalogToLibrary, setActive };

  // ---------- boot ----------
  async function boot() {
    _db = await openDB();
    state.objects = await getAll('objects');
    state.photos = await getAll('photos');
    state.activeId = await getSetting('activeId', null);
    const dim = await getSetting('dim', 0);
    dimSlider.value = dim;
    applyDim(dim);

    renderLibrary();
    renderPhotos();
    await renderNow();
    show('now');

    window.SP.ready = true;
    window.dispatchEvent(new Event('sp-ready'));

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  boot().catch((err) => {
    document.body.innerHTML = '<p style="color:#d40000;padding:24px">Failed to start: ' + err.message + '</p>';
  });
})();
