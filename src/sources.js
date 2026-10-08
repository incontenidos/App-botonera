// Funciones puras para reconocer links, tiempos y archivos de audio.
// No tocan el DOM, así se pueden testear con `node --test`.

const URL_RE = /https?:\/\/[^\s<>"']+|spotify:[a-z]+:[A-Za-z0-9]+/i;

/** Devuelve el primer link encontrado en un texto (p. ej. lo que comparte la app de YouTube). */
export function extractFirstUrl(text) {
  if (!text) return null;
  const match = String(text).match(URL_RE);
  return match ? match[0].replace(/[).,;]+$/, '') : null;
}

/**
 * Convierte "83", "1:23", "01:02:03", "1m23s", "1h2m3s" o "83s" en segundos.
 * Devuelve null si no se puede interpretar.
 */
export function parseTime(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim().toLowerCase().replace(',', '.');
  if (str === '') return null;
  if (/^\d+(\.\d+)?$/.test(str)) return Number(str);
  if (/^\d+(:\d{1,2}){1,2}(\.\d+)?$/.test(str)) {
    return str.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
  }
  const hms = str.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/);
  if (hms && (hms[1] || hms[2] || hms[3])) {
    return Number(hms[1] || 0) * 3600 + Number(hms[2] || 0) * 60 + Number(hms[3] || 0);
  }
  return null;
}

/** 83.4 -> "1:23.4", 5 -> "0:05". */
export function formatTime(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '';
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const sec = Number.isInteger(s) ? String(s).padStart(2, '0') : s.toFixed(1).padStart(4, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

const YT_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'];
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const SPOTIFY_TYPES = ['track', 'episode', 'album', 'playlist', 'show', 'artist'];

/**
 * Reconoce links de YouTube, Spotify o de un archivo de audio directo.
 * @returns {null | {kind:'youtube', videoId:string, start:number|null}
 *   | {kind:'spotify', type:string, id:string, uri:string}
 *   | {kind:'url', url:string}}
 */
export function parseMediaUrl(input) {
  const raw = extractFirstUrl(input) || (input ? String(input).trim() : '');
  if (!raw) return null;

  const spotifyUri = raw.match(/^spotify:([a-z]+):([A-Za-z0-9]+)$/i);
  if (spotifyUri && SPOTIFY_TYPES.includes(spotifyUri[1].toLowerCase())) {
    const type = spotifyUri[1].toLowerCase();
    return { kind: 'spotify', type, id: spotifyUri[2], uri: `spotify:${type}:${spotifyUri[2]}` };
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.toLowerCase();

  if (host === 'youtu.be' || YT_HOSTS.includes(host)) {
    let videoId = null;
    if (host === 'youtu.be') {
      videoId = url.pathname.split('/')[1];
    } else if (url.pathname === '/watch') {
      videoId = url.searchParams.get('v');
    } else {
      const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
      if (m) videoId = m[1];
    }
    if (!videoId || !YT_ID_RE.test(videoId)) return null;
    const t = url.searchParams.get('t') ?? url.searchParams.get('start');
    return { kind: 'youtube', videoId, start: parseTime(t) };
  }

  if (host === 'open.spotify.com' || host === 'play.spotify.com') {
    // Ej: /track/ID, /intl-es/track/ID, /embed/track/ID
    const parts = url.pathname.split('/').filter(Boolean).filter((p) => !/^intl-/.test(p) && p !== 'embed');
    const type = parts[0];
    const id = parts[1];
    if (SPOTIFY_TYPES.includes(type) && id && /^[A-Za-z0-9]+$/.test(id)) {
      return { kind: 'spotify', type, id, uri: `spotify:${type}:${id}` };
    }
    return null;
  }

  return { kind: 'url', url: url.href };
}

const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'webm', 'weba', 'amr', 'mpeg', 'mpga', '3gp', 'caf', 'aif', 'aiff', 'mp4', 'mov'];

export function fileExtension(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

/** Acepta audio/* y video/* (se usa la pista de audio) o extensiones conocidas aunque falte el MIME. */
export function isAudioFile(file) {
  if (!file) return false;
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('audio/') || type.startsWith('video/')) return true;
  return AUDIO_EXT.includes(fileExtension(file.name));
}

/** WhatsApp suele mandar las notas de voz sin MIME o como octet-stream: lo deducimos de la extensión. */
export function guessMime(file) {
  const type = (file.type || '').toLowerCase();
  if (type && type !== 'application/octet-stream') return file.type;
  const ext = fileExtension(file.name);
  return {
    opus: 'audio/ogg', ogg: 'audio/ogg', oga: 'audio/ogg', mp3: 'audio/mpeg', mpeg: 'audio/mpeg', mpga: 'audio/mpeg',
    m4a: 'audio/mp4', mp4: 'video/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', webm: 'audio/webm',
    weba: 'audio/webm', amr: 'audio/amr', '3gp': 'audio/3gpp', caf: 'audio/x-caf', aif: 'audio/aiff', aiff: 'audio/aiff',
    mov: 'video/quicktime',
  }[ext] || 'audio/mpeg';
}

/** ¿El archivo viene de WhatsApp? (PTT-20240101-WA0001.opus, AUD-..., "WhatsApp Audio 2024-01-01 at ...") */
export function isWhatsAppFile(name) {
  return /^(PTT|AUD|VID)-\d{8}-WA\d+/i.test(name || '') || /whats\s?app/i.test(name || '');
}

/** Nombre amigable para el botón a partir del nombre de archivo. */
export function friendlyName(fileName, now = new Date()) {
  const name = String(fileName || '').trim();
  if (!name) return 'Sonido nuevo';
  if (isWhatsAppFile(name)) {
    const d = name.match(/(\d{4})-?(\d{2})-?(\d{2})/);
    const date = d ? `${d[3]}/${d[2]}` : `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}`;
    return `Audio WhatsApp ${date}`;
  }
  const base = name.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base) return 'Sonido nuevo';
  const short = base.length > 28 ? `${base.slice(0, 27)}…` : base;
  return short.charAt(0).toUpperCase() + short.slice(1);
}
