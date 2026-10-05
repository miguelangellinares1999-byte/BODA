// Motor de subida: cola, compresión, sesiones reanudables de Drive, trozos,
// reintentos con backoff y plan B (proxy por Apps Script) si falla el CORS.
(function () {
  'use strict';

  const MAX_AUTO_RETRIES = 12;      // reintentos automáticos seguidos sin avanzar
  const STALL_MS = 45000;           // sin progreso durante 45 s => se reintenta el trozo
  const FATAL_ERRORS = {
    bad_key: 'El enlace no es válido. Vuelve a escanear el código QR.',
    bad_type: 'Solo se pueden subir fotos y vídeos.',
    too_large: 'Este archivo es demasiado grande.',
    bad_size: 'Este archivo parece estar vacío o dañado.'
  };

  const EXT_TYPES = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif',
    webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', dng: 'image/dng',
    mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', '3gp': 'video/3gpp',
    webm: 'video/webm', mkv: 'video/x-matroska'
  };

  function detectType(file) {
    let t = (file.type || '').toLowerCase();
    if (t === 'image/jpg') t = 'image/jpeg';
    if (/^(image|video)\//.test(t)) return t;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    return EXT_TYPES[ext] || t || '';
  }

  class NetError extends Error {
    constructor(msg, opts) {
      super(msg);
      Object.assign(this, opts || {});
    }
  }

  class Uploader {
    constructor(cfg, key, getGuest) {
      this.cfg = cfg;
      this.key = key;
      this.getGuest = getGuest;
      this.items = [];
      this.active = 0;
      this.nextId = 1;
      this.mode = 'direct';        // 'direct' (navegador -> Drive) o 'proxy' (plan B)
      this.directWorked = false;   // algún trozo directo ha llegado bien
      this.corsSuspicion = 0;
      this.compressChain = Promise.resolve();
      this.listeners = new Set();
      this.wakeAll = this.wakeAll.bind(this);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.wakeAll();
      });
      window.addEventListener('online', this.wakeAll);
      window.addEventListener('pageshow', this.wakeAll);
    }

    onChange(fn) { this.listeners.add(fn); }
    emit(item) { this.listeners.forEach((fn) => fn(item)); }

    // ---------- API de Apps Script ----------
    async api(payload, timeoutMs) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs || 45000);
      try {
        // Cuerpo como texto plano: petición "simple", sin preflight CORS.
        const res = await fetch(this.cfg.API_URL, {
          method: 'POST',
          body: JSON.stringify(Object.assign({ k: this.key }, payload)),
          redirect: 'follow',
          cache: 'no-store',
          signal: ctrl.signal
        });
        if (!res.ok) throw new NetError('http_' + res.status, { retry: true });
        return await res.json();
      } catch (e) {
        if (e instanceof NetError) throw e;
        throw new NetError('network', { retry: true });
      } finally {
        clearTimeout(timer);
      }
    }

    // ---------- Cola ----------
    add(files) {
      const added = [];
      for (const file of files) {
        const type = detectType(file);
        const kind = type.startsWith('video/') ? 'video' : type.startsWith('image/') ? 'photo' : null;
        const item = {
          id: this.nextId++, file, type, kind,
          size: file.size, sent: 0, offset: 0,
          state: 'pending', error: '', attempts: 0,
          blob: null, uploadName: null, uploadType: null,
          session: null, needsResync: false, retryAt: 0, wake: null
        };
        if (!kind) {
          item.state = 'rejected';
          item.error = 'Este archivo no es una foto ni un vídeo.';
        } else if (!file.size) {
          item.state = 'rejected';
          item.error = 'Este archivo está vacío.';
        } else if (kind === 'video' && file.size > this.cfg.MAX_VIDEO_BYTES) {
          item.state = 'rejected';
          item.error = '¡Qué recuerdo tan largo! Este vídeo pasa de 1 GB y no cabe. ' +
            'Si puedes, recórtalo un poquito y vuelve a intentarlo 💐';
        }
        this.items.push(item);
        added.push(item);
      }
      added.forEach((it) => this.emit(it));
      this.pump();
      return added;
    }

    retry(id) {
      const item = this.items.find((i) => i.id === id);
      if (!item || item.state !== 'error') return;
      item.state = 'pending';
      item.error = '';
      item.attempts = 0;
      item.needsResync = !!item.session;
      this.emit(item);
      this.pump();
    }

    retryAllFailed() {
      this.items.filter((i) => i.state === 'error').forEach((i) => this.retry(i.id));
    }

    isBusy() {
      return this.items.some((i) => ['pending', 'compressing', 'uploading', 'waiting'].includes(i.state));
    }

    wakeAll() {
      this.items.forEach((i) => { if (i.wake) i.wake(); });
    }

    pump() {
      while (this.active < this.cfg.PARALLEL_UPLOADS) {
        const next = this.items.find((i) => i.state === 'pending');
        if (!next) break;
        this.active++;
        next.state = 'queued';
        this.run(next).finally(() => {
          this.active--;
          this.pump();
          this.emit(null); // aviso general (p. ej. para detectar el final)
        });
      }
    }

    // ---------- Proceso de un archivo ----------
    async run(item) {
      if (!item.blob) {
        if (item.kind === 'photo') {
          item.state = 'compressing';
          this.emit(item);
          const result = await this.serializedCompress(item);
          Object.assign(item, { blob: result.blob, uploadName: result.name, uploadType: result.type });
          item.compressed = result.compressed;
          item.thumb = result.thumb || null;
        } else {
          Object.assign(item, { blob: item.file, uploadName: item.file.name, uploadType: item.type });
        }
        item.size = item.blob.size;
        if (item.kind === 'photo' && item.size > this.cfg.MAX_IMAGE_BYTES) {
          item.state = 'rejected';
          item.error = 'Esta foto es demasiado grande.';
          this.emit(item);
          return;
        }
      }

      item.state = 'uploading';
      this.emit(item);

      for (;;) {
        try {
          await this.transfer(item);
          item.state = 'done';
          item.sent = item.size;
          item.blob = null; // libera memoria
          this.emit(item);
          return;
        } catch (e) {
          if (e.fatal) {
            item.state = 'error';
            item.error = e.message;
            item.fatal = true;
            this.emit(item);
            return;
          }
          item.attempts++;
          item.needsResync = !!item.session;
          if (item.attempts > MAX_AUTO_RETRIES) {
            item.state = 'error';
            item.error = 'No hemos podido subirlo. Revisa tu conexión y pulsa «Reintentar».';
            this.emit(item);
            return;
          }
          const delay = Math.min(30000, 1000 * Math.pow(2, item.attempts - 1)) * (0.8 + Math.random() * 0.4);
          item.state = 'waiting';
          item.retryAt = Date.now() + delay;
          this.emit(item);
          await this.sleep(item, delay);
          item.state = 'uploading';
          this.emit(item);
        }
      }
    }

    serializedCompress(item) {
      const p = this.compressChain.then(() =>
        window.BodaCompress.compressImage(item.file, item.type, {
          maxSide: this.cfg.MAX_IMAGE_SIDE,
          quality: this.cfg.JPEG_QUALITY
        })
      ).catch(() => ({ blob: item.file, name: item.file.name, type: item.type, compressed: false }));
      this.compressChain = p.then(() => {}, () => {});
      return p;
    }

    // Espera "delay" ms, pero se despierta antes si vuelve la pantalla o la red.
    // Si no hay conexión, espera a que vuelva.
    sleep(item, delay) {
      return new Promise((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          item.wake = null;
          resolve();
        };
        const timer = setTimeout(() => {
          if (navigator.onLine === false) return; // seguirá esperando al evento 'online'
          finish();
        }, delay);
        item.wake = () => {
          if (navigator.onLine === false) return;
          finish();
        };
      });
    }

    async transfer(item) {
      if (!item.session) {
        const r = await this.api({
          action: 'init',
          fileName: item.uploadName,
          mimeType: item.uploadType,
          size: item.size,
          guest: this.getGuest()
        });
        if (!r.ok) throw this.serverError(r);
        item.session = r.uploadUrl;
        item.driveName = r.name;
        item.offset = 0;
        item.needsResync = false;
      }

      if (item.needsResync) {
        const r = await this.api({ action: 'status', uploadUrl: item.session, total: item.size });
        if (!r.ok) {
          if (r.error === 'session_expired') {
            item.session = null;
            item.offset = 0;
            item.sent = 0;
            return this.transfer(item);
          }
          throw this.serverError(r);
        }
        item.needsResync = false;
        if (r.done) return;
        item.offset = r.offset;
        item.sent = r.offset;
        this.emit(item);
      }

      while (item.offset < item.size) {
        const before = item.offset;
        const finished = this.mode === 'direct'
          ? await this.sendDirect(item)
          : await this.sendProxy(item);
        if (finished) return;
        if (item.offset > before) item.attempts = 0; // ha avanzado: reiniciamos el contador
      }
    }

    serverError(r) {
      if (FATAL_ERRORS[r.error]) return new NetError(FATAL_ERRORS[r.error], { fatal: true });
      if (r.error === 'session_expired') return new NetError('expired', { retry: true });
      return new NetError(r.error || 'server', { retry: true });
    }

    // ----- Modo directo: PUT del trozo a la URL de sesión de Drive -----
    async sendDirect(item) {
      const start = item.offset;
      const end = Math.min(start + this.cfg.CHUNK_SIZE, item.size) - 1;
      const res = await this.putChunk(item, start, end);

      if (res.status === 200 || res.status === 201) {
        this.directWorked = true;
        item.offset = item.size;
        return true;
      }
      if (res.status === 308) {
        this.directWorked = true;
        const m = res.range && /bytes=0-(\d+)/.exec(res.range);
        // Si el navegador no nos deja leer "Range", Drive guarda trozos completos
        // (múltiplos de 256 KB), así que avanzamos hasta el final del trozo.
        item.offset = m ? Number(m[1]) + 1 : end + 1;
        item.sent = item.offset;
        this.emit(item);
        return false;
      }
      if (res.status === 404 || res.status === 410) {
        item.session = null; // sesión caducada: se crea otra
        item.offset = 0;
        item.sent = 0;
        throw new NetError('expired', { retry: true });
      }
      if (res.status === 0 && !this.directWorked) await this.checkCors();
      throw new NetError('chunk_' + res.status, { retry: true });
    }

    // Si la subida directa falla por "red" pero Apps Script responde bien,
    // probablemente el navegador está bloqueando por CORS: pasamos al plan B.
    async checkCors() {
      if (navigator.onLine === false || document.visibilityState === 'hidden') return;
      try {
        const r = await this.api({ action: 'ping' }, 15000);
        if (r.ok && ++this.corsSuspicion >= 2 && this.mode === 'direct') {
          this.mode = 'proxy';
          console.warn('[boda] Subida directa bloqueada: usando plan B (proxy por Apps Script).');
        }
      } catch (e) { /* sin red de verdad: no es CORS */ }
    }

    putChunk(item, start, end) {
      return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        let lastProgress = Date.now();
        const watchdog = setInterval(() => {
          if (Date.now() - lastProgress > STALL_MS) xhr.abort();
        }, 5000);
        const finish = (status) => {
          clearInterval(watchdog);
          let range = null;
          // Solo la leemos si Drive la expone (si no, el navegador da un aviso).
          if (/(^|\n)range:/i.test(xhr.getAllResponseHeaders() || '')) range = xhr.getResponseHeader('Range');
          resolve({ status, range });
        };
        xhr.open('PUT', item.session, true);
        xhr.setRequestHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + item.size);
        xhr.upload.onprogress = (ev) => {
          lastProgress = Date.now();
          item.sent = start + ev.loaded;
          this.emit(item);
        };
        xhr.onload = () => finish(xhr.status);
        xhr.onerror = () => finish(0);
        xhr.onabort = () => finish(0);
        xhr.ontimeout = () => finish(0);
        xhr.timeout = 15 * 60 * 1000;
        xhr.send(item.blob.slice(start, end + 1));
      });
    }

    // ----- Plan B: trozo en base64 a Apps Script, que lo reenvía a Drive -----
    async sendProxy(item) {
      const start = item.offset;
      const end = Math.min(start + this.cfg.PROXY_CHUNK_SIZE, item.size) - 1;
      const data = await blobToBase64(item.blob.slice(start, end + 1));
      const r = await this.api({
        action: 'chunk', uploadUrl: item.session, start, total: item.size, data
      }, 180000);
      if (!r.ok) {
        if (r.error === 'session_expired') {
          item.session = null;
          item.offset = 0;
          item.sent = 0;
        }
        throw this.serverError(r);
      }
      if (r.done) {
        item.offset = item.size;
        return true;
      }
      item.offset = r.offset;
      item.sent = r.offset;
      this.emit(item);
      return false;
    }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const s = String(fr.result);
        resolve(s.slice(s.indexOf(',') + 1));
      };
      fr.onerror = () => reject(new NetError('read', { retry: true }));
      fr.readAsDataURL(blob);
    });
  }

  window.BodaUploader = Uploader;
  window.BodaDetectType = detectType;
})();
