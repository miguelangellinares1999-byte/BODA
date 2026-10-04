// Configuración de la web. Solo hay que cambiar API_URL (ver README, paso 6).
window.BODA_CONFIG = {
  // URL de la Aplicación web de Apps Script (termina en /exec).
  API_URL: 'https://script.google.com/macros/s/AKfycbxfHP6xo0jklLE4a-BtyZ2ZIdEfjKXDjwmulqQHi04jcws4gOXf6FLGPeWbV5Axt7yA/exec',

  // Tamaño de cada trozo en subida directa a Drive (múltiplo de 256 KB).
  CHUNK_SIZE: 8 * 1024 * 1024,
  // Tamaño de cada trozo en el plan B (a través de Apps Script, en base64).
  PROXY_CHUNK_SIZE: 4 * 1024 * 1024,
  // Archivos que se suben a la vez.
  PARALLEL_UPLOADS: 2,

  // Compresión de fotos.
  MAX_IMAGE_SIDE: 3000,
  JPEG_QUALITY: 0.85,

  // Límites (deben coincidir con Code.gs).
  MAX_VIDEO_BYTES: 1024 * 1024 * 1024,
  MAX_IMAGE_BYTES: 200 * 1024 * 1024
};
