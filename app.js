// Interfaz de la web de invitados.
(function () {
  'use strict';

  const cfg = window.BODA_CONFIG;
  const $ = (id) => document.getElementById(id);
  const screens = ['screen-start', 'screen-upload', 'screen-thanks', 'screen-nokey'];

  const ICON_VIDEO = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M16 10.5l5-3v9l-5-3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const ICON_PHOTO = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="10" r="1.8" fill="currentColor"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const ICON_CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // ---------- Almacenamiento local seguro ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* modo privado */ } }
  };

  function show(id) {
    screens.forEach((s) => { $(s).hidden = s !== id; });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- Código del evento ----------
  const params = new URLSearchParams(location.search);
  const key = (params.get('k') || store.get('boda_k') || '').trim();
  if (params.get('k')) store.set('boda_k', key);

  if (!cfg || !cfg.API_URL || cfg.API_URL.indexOf('PEGA_AQUI') === 0) {
    $('nokey-text').textContent = 'La web aún no está configurada (falta la URL de Apps Script en config.js).';
    show('screen-nokey');
    return;
  }
  if (!key) {
    show('screen-nokey');
    return;
  }

  // ---------- Nombre del invitado ----------
  const guestInput = $('guest');
  guestInput.value = store.get('boda_nombre') || '';
  guestInput.addEventListener('input', () => store.set('boda_nombre', guestInput.value.trim()));
  guestInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') guestInput.blur(); });
  const getGuest = () => guestInput.value.trim();

  const uploader = new window.BodaUploader(cfg, key, getGuest);

  // Comprobación silenciosa del código (si falla la red, no molestamos).
  uploader.api({ action: 'ping' }, 20000).then((r) => {
    if (r && r.ok === false && r.error === 'bad_key') {
      $('nokey-text').textContent = 'Este enlace no es válido. Vuelve a escanear el código QR de las mesas.';
      show('screen-nokey');
    }
  }).catch(() => {});

  // ---------- Selección de archivos ----------
  const fileInput = $('file-input');
  let batchStartId = 1;

  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = ''; // permite volver a elegir los mismos
    if (!files.length) return;
    if ($('screen-upload').hidden || (!uploader.isBusy() && !hasErrors())) {
      // Nueva tanda: limpiamos la lista visual de la anterior.
      $('file-list').innerHTML = '';
      rows.clear();
      batchStartId = uploader.nextId;
    }
    show('screen-upload');
    uploader.add(files);
    updateWakeLock();
  });

  // Los <label role="button"> también se activan con teclado.
  document.querySelectorAll('label[for="file-input"]').forEach((l) => {
    l.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });
  });

  $('retry-all').addEventListener('click', () => uploader.retryAllFailed());

  // ---------- Pintado ----------
  const rows = new Map();
  let renderQueued = false;
  const dirty = new Set();

  uploader.onChange((item) => {
    if (item) dirty.add(item);
    if (!renderQueued) {
      renderQueued = true;
      requestAnimationFrame(render);
    }
  });

  function batchItems() {
    return uploader.items.filter((i) => i.id >= batchStartId);
  }
  function hasErrors() {
    return batchItems().some((i) => i.state === 'error');
  }

  function render() {
    renderQueued = false;
    dirty.forEach(renderItem);
    dirty.clear();
    renderTotal();
    updateWakeLock();
    maybeFinish();
  }

  function renderItem(item) {
    let row = rows.get(item.id);
    if (!row || !row.el.isConnected) {
      const li = document.createElement('li');
      li.className = 'item';
      li.innerHTML =
        '<div class="thumb">' + (item.kind === 'video' ? ICON_VIDEO : ICON_PHOTO) + '</div>' +
        '<div class="meta"><div class="name"></div><div class="status"></div>' +
        '<div class="bar"><span></span></div></div><div class="side"></div>';
      li.querySelector('.name').textContent = item.file.name;
      $('file-list').appendChild(li);
      row = {
        el: li,
        thumb: li.querySelector('.thumb'),
        status: li.querySelector('.status'),
        bar: li.querySelector('.bar > span'),
        side: li.querySelector('.side'),
        hasThumb: false,
        side_state: ''
      };
      rows.set(item.id, row);
    }
    row.el.dataset.state = item.state;
    if (item.thumb && !row.hasThumb) {
      row.hasThumb = true;
      row.thumb.innerHTML = '';
      const img = new Image();
      img.alt = '';
      img.src = item.thumb;
      row.thumb.appendChild(img);
    }
    const pct = item.size ? Math.min(100, Math.floor((item.sent / item.size) * 100)) : 0;
    row.bar.style.width = (item.state === 'done' ? 100 : item.state === 'compressing' ? 8 : pct) + '%';
    row.status.textContent = statusText(item, pct);

    const sideState = item.state === 'done' ? 'done' : item.state === 'error' ? 'error' : '';
    if (sideState !== row.side_state) {
      row.side_state = sideState;
      row.side.innerHTML = '';
      if (sideState === 'done') {
        row.side.innerHTML = '<span class="check" aria-label="Subido">' + ICON_CHECK + '</span>';
      } else if (sideState === 'error') {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'retry';
        b.textContent = 'Reintentar';
        b.addEventListener('click', () => uploader.retry(item.id));
        row.side.appendChild(b);
      }
    }
  }

  function statusText(item, pct) {
    switch (item.state) {
      case 'pending':
      case 'queued': return 'En cola · ' + formatBytes(item.size);
      case 'compressing': return 'Comprimiendo…';
      case 'uploading': return 'Subiendo… ' + pct + ' % · ' + formatBytes(item.size);
      case 'waiting': return navigator.onLine === false
        ? 'Sin conexión. Seguirá en cuanto vuelva…'
        : 'Conexión inestable, reintentando… ' + pct + ' %';
      case 'done': return 'Subido ✓';
      case 'error': return item.error || 'Error al subir';
      case 'rejected': return item.error;
      default: return '';
    }
  }

  function renderTotal() {
    const items = batchItems().filter((i) => i.state !== 'rejected');
    const total = items.reduce((s, i) => s + i.size, 0);
    const sent = items.reduce((s, i) => s + (i.state === 'done' ? i.size : Math.min(i.sent, i.size)), 0);
    const done = items.filter((i) => i.state === 'done').length;
    const pct = total ? Math.floor((sent / total) * 100) : 0;
    $('total-bar').style.width = pct + '%';
    $('total-pct').textContent = pct + ' %';
    const errors = items.filter((i) => i.state === 'error').length;
    if (!items.length) {
      $('total-label').textContent = 'No hay archivos que subir';
    } else if (done === items.length) {
      $('total-label').textContent = '¡Listo! ' + done + (done === 1 ? ' archivo subido' : ' archivos subidos');
    } else {
      $('total-label').textContent = 'Subidos ' + done + ' de ' + items.length;
    }
    $('retry-all').hidden = errors === 0;
    $('total-note').textContent = errors && !uploader.isBusy()
      ? 'Algunos archivos no se han podido subir. Pulsa «Reintentar».'
      : 'Mantén esta página abierta hasta que termine 💚';
  }

  let finishTimer = null;
  function maybeFinish() {
    clearTimeout(finishTimer);
    if (uploader.isBusy()) return;
    const items = batchItems();
    const done = items.filter((i) => i.state === 'done').length;
    if (!done || items.some((i) => i.state === 'error')) return;
    const rejected = items.filter((i) => i.state === 'rejected').length;
    finishTimer = setTimeout(() => {
      if (uploader.isBusy() || $('screen-upload').hidden) return;
      const name = getGuest().split(/\s+/)[0];
      $('thanks-title').textContent = name ? '¡Gracias, ' + name + '!' : '¡Gracias!';
      $('thanks-text').textContent = (done === 1
        ? 'Tu recuerdo ya está con nosotros. Nos hace muchísima ilusión verlo.'
        : 'Tus ' + done + ' recuerdos ya están con nosotros. Nos hace muchísima ilusión verlos.') +
        (rejected ? ' (' + rejected + (rejected === 1 ? ' archivo no se pudo' : ' archivos no se pudieron') + ' subir).' : '');
      $('file-list').innerHTML = '';
      rows.clear();
      batchStartId = uploader.nextId;
      show('screen-thanks');
    }, 900);
  }

  function formatBytes(n) {
    if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
    return (n / 1073741824).toFixed(2).replace('.', ',') + ' GB';
  }

  // ---------- Que no se apague la pantalla mientras sube ----------
  let wakeLock = null;
  async function updateWakeLock() {
    const busy = uploader.isBusy();
    try {
      if (busy && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!busy && wakeLock) {
        const wl = wakeLock;
        wakeLock = null;
        await wl.release();
      }
    } catch (e) { wakeLock = null; }
  }
  document.addEventListener('visibilitychange', updateWakeLock);

  window.addEventListener('beforeunload', (e) => {
    if (uploader.isBusy()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Para las pruebas automáticas.
  window.__boda = { uploader };
})();
