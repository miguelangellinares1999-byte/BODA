// Dibuja el cartel del QR (SVG vectorial) con los colores de la boda y lo
// convierte a PNG de alta resolución. Usa qrcode.js (Kazuhiko Arase, MIT).
(function () {
  'use strict';

  var W = 1200, H = 1500;
  var QR_X = 230, QR_Y = 250, QR_SIZE = 740;   // incluye el margen blanco de 4 módulos
  var DARK = '#4C6141';     // verde salvia oscuro (contraste suficiente para escanear)
  var EYE = '#B4707A';      // rosa empolvado intenso para el centro de los "ojos"
  var SAGE = '#9CAF88', BLUSH = '#E8B4B8', BLUSH_DARK = '#C98A90', TEXT = '#3F4B3E';
  var CAPTION_TOP = 'Comparte tus fotos y vídeos';
  var CAPTION_BOTTOM_NAMES = 'M&A';
  var CAPTION_BOTTOM_DATE = '05.06.2027';

  // Mismas ilustraciones que la web (eucalipto + peonías en acuarela).
  var ART_DEFS =
    '<filter id="wc" x="-15%" y="-15%" width="130%" height="130%">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="7" result="noise"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="noise" scale="6" xChannelSelector="R" yChannelSelector="G" result="d"/>' +
      '<feGaussianBlur in="d" stdDeviation="0.45"/></filter>' +
    '<radialGradient id="petal" cx="0.5" cy="1" r="1.05"><stop offset="0" stop-color="#D4868F"/><stop offset="0.5" stop-color="#E8B4B8"/><stop offset="1" stop-color="#F8E3E4"/></radialGradient>' +
    '<radialGradient id="petalDeep" cx="0.5" cy="1" r="1"><stop offset="0" stop-color="#C77983"/><stop offset="0.6" stop-color="#E1A3A9"/><stop offset="1" stop-color="#F1CDD0"/></radialGradient>' +
    '<linearGradient id="leaf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#86A074"/><stop offset="1" stop-color="#C3D1B6"/></linearGradient>' +
    '<path id="pt" d="M0 0 C-24 -5 -30 -42 -6 -54 C-2 -50 2 -50 6 -54 C30 -42 24 -5 0 0Z"/>' +
    '<path id="lf" d="M0 0 C8 -9 26 -10 34 0 C26 10 8 9 0 0Z"/>' +
    '<g id="sprig"><path d="M6 64 C70 46 150 30 262 6" fill="none" stroke="#8DA27C" stroke-width="2" stroke-linecap="round"/><g fill="url(#leaf)">' +
      '<ellipse cx="38" cy="44" rx="15" ry="12.5" opacity=".75" transform="rotate(-20 38 44)"/><ellipse cx="58" cy="72" rx="14" ry="12" opacity=".6" transform="rotate(25 58 72)"/>' +
      '<ellipse cx="88" cy="34" rx="14" ry="12" opacity=".8" transform="rotate(-15 88 34)"/><ellipse cx="112" cy="58" rx="13" ry="11" opacity=".55" transform="rotate(20 112 58)"/>' +
      '<ellipse cx="140" cy="24" rx="12.5" ry="10.5" opacity=".75" transform="rotate(-18 140 24)"/><ellipse cx="164" cy="44" rx="12" ry="10" opacity=".6" transform="rotate(15 164 44)"/>' +
      '<ellipse cx="190" cy="14" rx="11" ry="9" opacity=".7" transform="rotate(-18 190 14)"/><ellipse cx="212" cy="32" rx="10" ry="8.5" opacity=".55" transform="rotate(12 212 32)"/>' +
      '<ellipse cx="236" cy="6" rx="8.5" ry="7" opacity=".65"/><ellipse cx="252" cy="20" rx="7" ry="6" opacity=".5"/></g></g>' +
    '<g id="willow"><path d="M0 0 C50 60 110 110 196 150" fill="none" stroke="#9AAE8A" stroke-width="1.4" stroke-linecap="round"/><g fill="url(#leaf)" opacity=".6">' +
      '<use href="#lf" transform="translate(40 44) rotate(-80) scale(.9)"/><use href="#lf" transform="translate(52 60) rotate(10) scale(.95)"/>' +
      '<use href="#lf" transform="translate(84 84) rotate(-70) scale(.85)"/><use href="#lf" transform="translate(98 98) rotate(15) scale(.85)"/>' +
      '<use href="#lf" transform="translate(130 118) rotate(-60) scale(.75)"/><use href="#lf" transform="translate(146 128) rotate(20) scale(.7)"/>' +
      '<use href="#lf" transform="translate(178 142) rotate(-35) scale(.6)"/></g></g>' +
    '<g id="peony"><g fill="url(#petal)" opacity=".62">' +
      '<use href="#pt" transform="rotate(0) scale(1.05)"/><use href="#pt" transform="rotate(52)"/><use href="#pt" transform="rotate(104) scale(1.08)"/>' +
      '<use href="#pt" transform="rotate(156) scale(.98)"/><use href="#pt" transform="rotate(208) scale(1.04)"/><use href="#pt" transform="rotate(260)"/>' +
      '<use href="#pt" transform="rotate(312) scale(1.06)"/></g><g fill="url(#petal)" opacity=".7">' +
      '<use href="#pt" transform="rotate(26) scale(.72)"/><use href="#pt" transform="rotate(98) scale(.7)"/><use href="#pt" transform="rotate(170) scale(.74)"/>' +
      '<use href="#pt" transform="rotate(242) scale(.7)"/><use href="#pt" transform="rotate(314) scale(.72)"/></g><g fill="url(#petalDeep)" opacity=".75">' +
      '<use href="#pt" transform="scale(.45)"/><use href="#pt" transform="rotate(90) scale(.42)"/><use href="#pt" transform="rotate(180) scale(.46)"/>' +
      '<use href="#pt" transform="rotate(270) scale(.42)"/></g><g fill="#C27C85" opacity=".55"><circle cx="-4" cy="-3" r="3"/><circle cx="4" cy="2" r="2.6"/>' +
      '<circle cx="1" cy="-7" r="2.2"/><circle cx="-6" cy="5" r="2"/></g></g>' +
    '<g id="corner"><g filter="url(#wc)"><use href="#willow" transform="translate(4 8)"/><use href="#sprig" transform="translate(0 4)"/>' +
      '<use href="#sprig" transform="matrix(0 1 1 0 4 0)"/><use href="#peony" transform="translate(70 72) scale(.95)"/>' +
      '<use href="#peony" transform="translate(168 40) rotate(30) scale(.42)"/><use href="#peony" transform="translate(38 168) rotate(-20) scale(.48)"/>' +
      '<g fill="#E8B4B8" opacity=".55"><circle cx="214" cy="56" r="3.2"/><circle cx="224" cy="62" r="2.4"/><circle cx="60" cy="226" r="3"/>' +
      '<circle cx="52" cy="236" r="2.2"/><circle cx="132" cy="132" r="2.6"/></g></g></g>';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Descarga la fuente de Google Fonts (solo las letras usadas) y la incrusta
  // en el SVG para que se vea igual al abrirlo en cualquier sitio.
  async function fontFace(family, cssFamily, text, extra) {
    try {
      var url = 'https://fonts.googleapis.com/css2?family=' + cssFamily +
        '&text=' + encodeURIComponent(text);
      var css = await (await fetch(url)).text();
      var m = /url\((https:[^)]+)\)\s*format\('(\w+)'\)/.exec(css);
      if (!m) return '';
      var buf = await (await fetch(m[1])).arrayBuffer();
      var bin = '';
      var bytes = new Uint8Array(buf);
      for (var i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
      return '@font-face{font-family:"' + family + '";' + (extra || '') +
        'src:url(data:font/' + m[2] + ';base64,' + btoa(bin) + ') format("' + m[2] + '");}';
    } catch (e) {
      return ''; // sin conexión: se usarán fuentes del sistema
    }
  }

  function qrPaths(text) {
    var qr = window.qrcode(0, 'Q'); // corrección de errores alta (25 %)
    qr.addData(text, 'Byte');
    qr.make();
    var n = qr.getModuleCount();
    var total = n + 8;            // 4 módulos de margen a cada lado
    var cell = QR_SIZE / total;
    var ox = QR_X + 4 * cell, oy = QR_Y + 4 * cell;
    var inFinder = function (r, c) {
      return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
    };
    var d = '';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (!qr.isDark(r, c) || inFinder(r, c)) continue;
        // Cuadrados nítidos y unidos: lo más fiable para cualquier lector.
        d += 'M' + (ox + c * cell).toFixed(2) + ' ' + (oy + r * cell).toFixed(2) +
          'h' + cell.toFixed(2) + 'v' + cell.toFixed(2) + 'h-' + cell.toFixed(2) + 'z';
      }
    }
    var eyes = '';
    [[0, 0], [0, n - 7], [n - 7, 0]].forEach(function (p) {
      var x = ox + p[1] * cell, y = oy + p[0] * cell;
      eyes +=
        '<rect x="' + (x + cell / 2) + '" y="' + (y + cell / 2) + '" width="' + (6 * cell) + '" height="' + (6 * cell) +
          '" rx="' + (0.35 * cell) + '" fill="none" stroke="' + DARK + '" stroke-width="' + cell + '"/>' +
        '<rect x="' + (x + 2 * cell) + '" y="' + (y + 2 * cell) + '" width="' + (3 * cell) + '" height="' + (3 * cell) +
          '" rx="' + (0.25 * cell) + '" fill="' + EYE + '"/>';
    });
    return '<path d="' + d + '" fill="' + DARK + '" shape-rendering="crispEdges"/>' + eyes;
  }

  async function buildSvg(url) {
    var fonts = (await Promise.all([
      fontFace('QR Script', 'Great+Vibes', CAPTION_BOTTOM_NAMES),
      fontFace('QR Serif', 'Cormorant+Garamond:ital,wght@1,500', CAPTION_TOP + CAPTION_BOTTOM_DATE + '·', 'font-style:italic;font-weight:500;')
    ])).join('');

    var cx = W / 2;
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + W + '" height="' + H +
      '" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<title>QR boda M&amp;A · 05.06.2027</title>' +
      '<defs><style>' + fonts + '</style>' + ART_DEFS + '</defs>' +
      '<rect width="' + W + '" height="' + H + '" fill="#ffffff"/>' +
      // Marco fino
      '<rect x="36" y="36" width="' + (W - 72) + '" height="' + (H - 72) + '" rx="34" fill="none" stroke="' + SAGE + '" stroke-width="2.5"/>' +
      '<rect x="50" y="50" width="' + (W - 100) + '" height="' + (H - 100) + '" rx="26" fill="none" stroke="' + BLUSH + '" stroke-width="1.5"/>' +
      // Flores
      '<use href="#corner" xlink:href="#corner" transform="translate(14 14) scale(1.1)"/>' +
      '<use href="#corner" xlink:href="#corner" transform="translate(' + (W - 14) + ' ' + (H - 14) + ') rotate(180) scale(1.1)"/>' +
      // Texto superior
      '<text x="' + cx + '" y="200" text-anchor="middle" font-family="QR Serif, Cormorant Garamond, Georgia, serif" font-style="italic" font-weight="500" font-size="62" fill="' + TEXT + '">' +
        esc(CAPTION_TOP) + '</text>' +
      // QR
      '<rect x="' + QR_X + '" y="' + QR_Y + '" width="' + QR_SIZE + '" height="' + QR_SIZE + '" rx="28" fill="#ffffff"/>' +
      qrPaths(url) +
      // Texto inferior: M&A · 05.06.2027
      '<text x="' + cx + '" y="1135" text-anchor="middle" fill="' + DARK + '">' +
        '<tspan font-family="QR Script, Great Vibes, cursive" font-size="104">' + esc(CAPTION_BOTTOM_NAMES) + '</tspan>' +
        '<tspan font-family="QR Serif, Cormorant Garamond, Georgia, serif" font-style="italic" font-size="64" fill="' + BLUSH_DARK + '" dx="22">·</tspan>' +
        '<tspan font-family="QR Serif, Cormorant Garamond, Georgia, serif" font-style="italic" font-weight="500" font-size="64" letter-spacing="6" dx="22">' +
          esc(CAPTION_BOTTOM_DATE) + '</tspan>' +
      '</text>' +
      '</svg>';
  }

  // Rasteriza el SVG a PNG (scale 4 => 4800 x 6000 px, ~40 x 50 cm a 300 ppp).
  function svgToPng(svg, scale) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = W * scale;
        c.height = H * scale;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error('png')); }, 'image/png');
      };
      img.onerror = function () { reject(new Error('svg')); };
      img.src = url;
    });
  }

  window.QRArt = { buildSvg: buildSvg, svgToPng: svgToPng };
})();
