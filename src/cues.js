// Lógica pura del Modo Función (lista de cues). Sin DOM, testeable con `node --test`.

/** Cómo sigue la función después de un cue. */
export const CONTINUE = {
  WAIT: 'wait', // espera el próximo GO
  FOLLOW: 'follow', // cuando termina este, arranca solo el siguiente
  AUTO: 'auto', // el siguiente arranca junto con este
};

export const MIN_DB = -60;
export const MAX_DB = 12;

/** dB relativos al volumen original -> ganancia lineal. -60 dB o menos = silencio. */
export function dbToGain(db) {
  const v = Number(db) || 0;
  if (v <= MIN_DB) return 0;
  return 10 ** (Math.min(v, MAX_DB) / 20);
}

export function clampDb(db) {
  const v = Math.round((Number(db) || 0) * 2) / 2; // pasos de 0,5 dB
  return Math.max(MIN_DB, Math.min(MAX_DB, v));
}

export function formatDb(db) {
  const v = clampDb(db);
  if (v <= MIN_DB) return '-∞ dB';
  return `${v > 0 ? '+' : ''}${String(v).replace('.', ',')} dB`;
}

/**
 * Al dar GO sobre el cue `index`: qué cues arrancan juntos (encadenados con "AUTO")
 * y dónde queda el próximo cue en espera.
 * @returns {{ fire: number[], next: number }}
 */
export function goFrom(cues, index) {
  const fire = [];
  let i = index;
  while (i >= 0 && i < cues.length) {
    fire.push(i);
    if (cues[i].continue !== CONTINUE.AUTO) break;
    i++;
  }
  return { fire, next: Math.min(i + 1, cues.length) };
}

/**
 * Cuando el cue `index` termina solo (no lo frenó nadie): si estaba en "FOLLOW",
 * devuelve el índice del cue que tiene que arrancar; si no, null.
 */
export function followAfter(cues, index) {
  const cue = cues[index];
  if (!cue || cue.continue !== CONTINUE.FOLLOW) return null;
  return index + 1 < cues.length ? index + 1 : null;
}

/** Duración efectiva teniendo en cuenta el recorte desde/hasta. */
export function effectiveDuration(cue) {
  if (cue.kind === 'stop') return cue.fade || 0;
  const total = cue.duration;
  if (!Number.isFinite(total)) return null;
  const start = Math.max(0, cue.start || 0);
  const end = cue.end && cue.end > start ? Math.min(cue.end, total) : total;
  return Math.max(0, end - start);
}

/** "mm:ss" estilo consola de sonido (sin décimas para lo largo). */
export function clock(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '--:--';
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return s < 60
    ? `${String(m).padStart(2, '0')}:${rest.toFixed(1).padStart(4, '0')}`
    : `${String(m).padStart(2, '0')}:${String(Math.floor(rest)).padStart(2, '0')}`;
}
