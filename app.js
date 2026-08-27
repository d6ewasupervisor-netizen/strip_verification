(function () {
  'use strict';

  // Soft PIN gate — client hash of "0827" (SHA-256). Soft access only.
  const PIN_HASH = '286aee2ea4a5ba67539432dc5ea3865c3b204d3caaccb662995388d156a279cf';
  const SESSION_KEY = 'stripGalleryUnlocked';
  const VISITOR_KEY = 'stripGalleryVisitor';
  const API_BASE = (function () {
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      return 'http://localhost:3001';
    }
    return 'https://eod-api.the-dump-bin.com';
  })();

  const els = {
    pinGate: document.getElementById('pin-gate'),
    pinInput: document.getElementById('pin-input'),
    pinSubmit: document.getElementById('pin-submit'),
    pinError: document.getElementById('pin-error'),
    appHeader: document.getElementById('app-header'),
    app: document.getElementById('app'),
    headerSub: document.getElementById('header-sub'),
    stats: document.getElementById('stats'),
    storeFilter: document.getElementById('store-filter'),
    tableHead: document.getElementById('table-head'),
    tableBody: document.getElementById('table-body'),
    btnBulk: document.getElementById('btn-bulk'),
    btnSignout: document.getElementById('btn-signout'),
    lightbox: document.getElementById('lightbox'),
    lbImg: document.getElementById('lb-img'),
    lbMeta: document.getElementById('lb-meta'),
    lbCounter: document.getElementById('lb-counter'),
    lbClose: document.getElementById('lb-close'),
    lbPrev: document.getElementById('lb-prev'),
    lbNext: document.getElementById('lb-next'),
  };

  let manifest = null;
  let lightboxIndex = -1;
  let filteredLightbox = [];

  function visitorId() {
    try {
      let id = localStorage.getItem(VISITOR_KEY);
      if (!id) {
        id = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem(VISITOR_KEY, id);
      }
      return id;
    } catch (_) {
      return 'anon';
    }
  }

  async function sha256Hex(text) {
    const data = new TextEncoder().encode(String(text));
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function track(action, detail) {
    const body = {
      action: String(action || 'unknown').slice(0, 80),
      detail: detail || {},
      visitorId: visitorId(),
      path: location.pathname,
      userAgent: navigator.userAgent.slice(0, 240),
      at: new Date().toISOString(),
    };
    fetch(API_BASE + '/api/strip-gallery/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
      mode: 'cors',
    }).catch(() => {});
  }

  function isUnlocked() {
    try { return sessionStorage.getItem(SESSION_KEY) === '1'; } catch (_) { return false; }
  }

  function setUnlocked(on) {
    try {
      if (on) sessionStorage.setItem(SESSION_KEY, '1');
      else sessionStorage.removeItem(SESSION_KEY);
    } catch (_) {}
  }

  async function tryUnlock() {
    const pin = String(els.pinInput.value || '').trim();
    const hash = await sha256Hex(pin);
    if (hash !== PIN_HASH) {
      els.pinError.hidden = false;
      track('pin_fail', {});
      return;
    }
    els.pinError.hidden = true;
    setUnlocked(true);
    track('pin_ok', {});
    showApp();
  }

  function showApp() {
    els.pinGate.hidden = true;
    els.appHeader.hidden = false;
    els.app.hidden = false;
    loadManifest();
  }

  async function loadManifest() {
    const res = await fetch('manifest.json?v=' + Date.now());
    manifest = await res.json();
    els.headerSub.textContent = (manifest.periodWeek || 'P08W2') + ' · photo review';
    filteredLightbox = manifest.lightbox || [];
    renderFilters();
    renderTable();
    track('view_gallery', {
      stores: (manifest.stores || []).length,
      photos: (manifest.lightbox || []).length,
    });
  }

  function renderFilters() {
    const stores = manifest.stores || [];
    els.storeFilter.innerHTML = '<option value="">All stores</option>' +
      stores.map((s) => `<option value="${s.storeNum}">FM${String(s.storeNum).padStart(3, '0')} ${escapeHtml(s.storeName)}</option>`).join('');
  }

  function currentStoreFilter() {
    const v = els.storeFilter.value;
    return v ? Number(v) : null;
  }

  function visibleStores() {
    const filter = currentStoreFilter();
    return (manifest.stores || []).filter((s) => filter == null || s.storeNum === filter);
  }

  function renderTable() {
    const stores = visibleStores();
    const maxO = manifest.maxOverallColumns || 0;
    const headers = ['Store #', 'Set', 'Strip'];
    for (let i = 0; i < maxO; i++) headers.push(manifest.overallHeaders[i] || ('Overall ' + String.fromCharCode(65 + i)));
    headers.push('Download');

    els.tableHead.innerHTML = '<tr>' + headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('') + '</tr>';

    let rows = '';
    let photoCount = 0;
    let setCount = 0;
    for (const store of stores) {
      for (const set of store.sets) {
        setCount += 1;
        if (set.strip) photoCount += 1;
        photoCount += (set.overalls || []).length;
        const stripCell = set.strip
          ? thumbHtml(set.strip, set, 'Strip')
          : '<div class="missing">—</div>';
        let overallCells = '';
        for (let i = 0; i < maxO; i++) {
          const o = (set.overalls || [])[i];
          overallCells += '<td>' + (o ? thumbHtml(o, set, o.label) : '<div class="missing">—</div>') + '</td>';
        }
        rows += `<tr>
          <td class="col-store">FM${String(store.storeNum).padStart(3, '0')}</td>
          <td class="col-set">
            <div class="set-name">${escapeHtml(set.setName)}</div>
            <div class="set-pog">${escapeHtml(set.pogId)}</div>
          </td>
          <td>${stripCell}</td>
          ${overallCells}
          <td><a class="store-zip" href="${escapeAttr(store.zip)}" download data-store-zip="${store.storeNum}">Store zip</a></td>
        </tr>`;
      }
    }
    els.tableBody.innerHTML = rows || '<tr><td colspan="8">No sets</td></tr>';
    els.stats.textContent = `${stores.length} store${stores.length === 1 ? '' : 's'} · ${setCount} sets · ${photoCount} photos`;

    els.tableBody.querySelectorAll('[data-photo]').forEach((img) => {
      img.addEventListener('click', () => openLightboxByPath(img.getAttribute('data-photo')));
    });
    els.tableBody.querySelectorAll('[data-store-zip]').forEach((a) => {
      a.addEventListener('click', () => {
        track('download_store_zip', { storeNum: Number(a.getAttribute('data-store-zip')) });
      });
    });

    // Rebuild filtered lightbox for current store filter
    const filter = currentStoreFilter();
    filteredLightbox = (manifest.lightbox || []).filter((p) => filter == null || p.storeNum === filter);
  }

  function thumbHtml(pic, set, label) {
    const idxHint = filteredLightbox.findIndex((p) => p.full === pic.full);
    return `<img class="thumb" src="${escapeAttr(pic.thumb)}" alt="${escapeAttr(label)}" loading="lazy" data-photo="${escapeAttr(pic.full)}" data-label="${escapeAttr(label)}" data-set="${escapeAttr(set.setName)}">`;
  }

  function openLightboxByPath(fullPath) {
    const idx = filteredLightbox.findIndex((p) => p.full === fullPath);
    if (idx < 0) return;
    openLightbox(idx);
  }

  function openLightbox(index) {
    if (!filteredLightbox.length) return;
    lightboxIndex = ((index % filteredLightbox.length) + filteredLightbox.length) % filteredLightbox.length;
    const p = filteredLightbox[lightboxIndex];
    els.lbImg.src = p.full;
    els.lbMeta.textContent = `FM${String(p.storeNum).padStart(3, '0')} ${p.storeName} · ${p.setName} · ${p.label}`;
    els.lbCounter.textContent = `${lightboxIndex + 1} / ${filteredLightbox.length}`;
    els.lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
    track('view_photo', {
      storeNum: p.storeNum,
      setName: p.setName,
      label: p.label,
      index: lightboxIndex,
    });
  }

  function closeLightbox() {
    els.lightbox.hidden = true;
    els.lbImg.removeAttribute('src');
    document.body.style.overflow = '';
    track('close_lightbox', {});
  }

  function stepLightbox(delta) {
    if (els.lightbox.hidden) return;
    openLightbox(lightboxIndex + delta);
  }

  function escapeHtml(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function escapeAttr(v) { return escapeHtml(v).replace(/'/g, '&#39;'); }

  els.pinSubmit.addEventListener('click', tryUnlock);
  els.pinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tryUnlock();
  });
  els.storeFilter.addEventListener('change', () => {
    track('filter_store', { storeNum: currentStoreFilter() });
    renderTable();
  });
  els.btnBulk.addEventListener('click', () => {
    if (!manifest) return;
    track('download_bulk_zip', {});
    const a = document.createElement('a');
    a.href = manifest.bulkZip;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
  els.btnSignout.addEventListener('click', () => {
    track('lock', {});
    setUnlocked(false);
    location.reload();
  });
  els.lbClose.addEventListener('click', closeLightbox);
  els.lbPrev.addEventListener('click', () => stepLightbox(-1));
  els.lbNext.addEventListener('click', () => stepLightbox(1));
  els.lightbox.addEventListener('click', (e) => {
    if (e.target === els.lightbox) closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (els.lightbox.hidden) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') stepLightbox(-1);
    if (e.key === 'ArrowRight') stepLightbox(1);
  });

  // Touch swipe
  let touchX = null;
  els.lightbox.addEventListener('touchstart', (e) => {
    touchX = e.changedTouches[0].screenX;
  }, { passive: true });
  els.lightbox.addEventListener('touchend', (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].screenX - touchX;
    touchX = null;
    if (Math.abs(dx) < 40) return;
    stepLightbox(dx < 0 ? 1 : -1);
  }, { passive: true });

  if (isUnlocked()) showApp();
  else els.pinInput.focus();
})();
