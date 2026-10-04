// Compresión de fotos en el navegador del invitado.
// - Redimensiona a MAX_IMAGE_SIDE px en el lado largo y recodifica a JPEG.
// - Respeta la orientación EXIF (los navegadores modernos la aplican al
//   decodificar con <img>, y drawImage dibuja la imagen ya girada).
// - Conserva los metadatos EXIF de las fotos JPEG (fecha, cámara...) con
//   la orientación puesta a 1, para que no se giren dos veces.
// - Si no se puede decodificar (p. ej. HEIC en Android) o el resultado ocupa
//   más que el original, devuelve el original sin tocar.
(function () {
  'use strict';

  const SKIP_TYPES = /^image\/(gif|svg\+xml)$/;
  const DECODE_TIMEOUT_MS = 30000;

  function loadImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      let finished = false;
      const done = (err) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        if (err || !img.naturalWidth) reject(err || new Error('decode'));
        else resolve(img);
      };
      const timer = setTimeout(() => done(new Error('timeout')), DECODE_TIMEOUT_MS);
      img.onload = () => done();
      img.onerror = () => done(new Error('decode'));
      img.decoding = 'async';
      img.src = url;
    });
  }

  function canvasToBlob(canvas, quality) {
    return new Promise((resolve) => {
      try {
        canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
      } catch (e) {
        resolve(null);
      }
    });
  }

  // ---------- EXIF: copiar el segmento APP1 del original ----------

  // Devuelve el segmento APP1 "Exif" (con su marcador) del JPEG original, o null.
  function extractExifSegment(buf) {
    const v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 <= v.byteLength) {
      const marker = v.getUint16(off);
      if ((marker & 0xff00) !== 0xff00) return null;
      if (marker === 0xffda || marker === 0xffd9) return null; // inicio de imagen: no hay más cabeceras
      const len = v.getUint16(off + 2);
      if (marker === 0xffe1 && off + 10 <= v.byteLength &&
          v.getUint32(off + 4) === 0x45786966 && v.getUint16(off + 8) === 0) { // "Exif\0\0"
        if (off + 2 + len > v.byteLength) return null;
        return new Uint8Array(buf.slice(off, off + 2 + len));
      }
      off += 2 + len;
    }
    return null;
  }

  // Pone la etiqueta Orientation (0x0112) del IFD0 a 1 (la imagen ya va girada).
  function resetOrientation(seg) {
    try {
      const v = new DataView(seg.buffer, seg.byteOffset, seg.byteLength);
      const tiff = 10; // FFE1 + longitud(2) + "Exif\0\0"(6)
      const little = v.getUint16(tiff) === 0x4949;
      const ifd0 = tiff + v.getUint32(tiff + 4, little);
      const count = v.getUint16(ifd0, little);
      for (let i = 0; i < count; i++) {
        const entry = ifd0 + 2 + i * 12;
        if (v.getUint16(entry, little) === 0x0112) {
          v.setUint16(entry + 8, 1, little);
          break;
        }
      }
    } catch (e) { /* EXIF raro: se deja tal cual */ }
    return seg;
  }

  // Inserta el APP1 en el JPEG nuevo, justo después de SOI (+ APP0 JFIF si existe).
  async function insertExif(jpegBlob, exifSeg) {
    const buf = await jpegBlob.arrayBuffer();
    const v = new DataView(buf);
    let pos = 2;
    if (v.getUint16(2) === 0xffe0) pos = 4 + v.getUint16(4);
    return new Blob([buf.slice(0, pos), exifSeg, buf.slice(pos)], { type: 'image/jpeg' });
  }

  // ---------------------------------------------------------------

  let sharedCanvas = null;

  /**
   * @returns {Promise<{blob: Blob, name: string, type: string, compressed: boolean, reason?: string}>}
   */
  async function compressImage(file, type, opts) {
    const original = { blob: file, name: file.name, type, compressed: false };
    if (SKIP_TYPES.test(type)) return Object.assign(original, { reason: 'skip_type' });

    let img;
    try {
      img = await loadImage(file);
    } catch (e) {
      return Object.assign(original, { reason: 'no_decode' }); // HEIC en Android, etc.
    }

    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const scale = Math.min(1, opts.maxSide / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));

    let blob = null;
    let thumb = null;
    try {
      const canvas = sharedCanvas || (sharedCanvas = document.createElement('canvas'));
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; // PNG con transparencia -> fondo blanco
      ctx.fillRect(0, 0, tw, th);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, tw, th);
      blob = await canvasToBlob(canvas, opts.quality);
      thumb = makeThumb(img, w, h);
      // Libera memoria (importante en iPhone).
      canvas.width = 1;
      canvas.height = 1;
    } catch (e) {
      blob = null;
    }
    img.src = '';

    original.thumb = thumb;
    if (!blob || !blob.size) return Object.assign(original, { reason: 'encode_failed' });
    if (blob.size >= file.size) return Object.assign(original, { reason: 'bigger' });

    if (type === 'image/jpeg') {
      try {
        const head = await file.slice(0, 256 * 1024).arrayBuffer();
        const exif = extractExifSegment(head);
        if (exif) blob = await insertExif(blob, resetOrientation(exif));
      } catch (e) { /* sin EXIF, no pasa nada */ }
    }

    const dot = file.name.lastIndexOf('.');
    const base = dot > 0 ? file.name.slice(0, dot) : file.name;
    return { blob, name: (base || 'foto') + '.jpg', type: 'image/jpeg', compressed: true, thumb };
  }

  // Miniatura cuadrada de 112 px para la lista (barata en memoria).
  function makeThumb(img, w, h) {
    try {
      const size = 112;
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const side = Math.min(w, h);
      c.getContext('2d').drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
      return c.toDataURL('image/jpeg', 0.7);
    } catch (e) {
      return null;
    }
  }

  window.BodaCompress = { compressImage };
})();
