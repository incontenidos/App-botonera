// Motor de audio del Modo Función: cada cue suena por Web Audio con su ganancia en dB
// (permite subir por encima del volumen original), fundidos de entrada/salida, recorte y loop.

import { dbToGain } from './cues.js?v=1.3';

const TICK_MS = 40;

export class ShowEngine {
  /**
   * @param {object} opts
   * @param {(cue:object, natural:boolean, preview:boolean)=>void} opts.onEnded natural = terminó solo (no lo frenó nadie)
   * @param {()=>void} opts.onTick se llama mientras hay algo sonando, para refrescar tiempos
   * @param {(msg:string)=>void} opts.onError
   */
  constructor({ onEnded, onTick, onError }) {
    this.onEnded = onEnded;
    this.onTick = onTick;
    this.onError = onError;
    this.ctx = null;
    this.running = new Map(); // cue.id -> run
    this.prepared = new Map(); // cue.id -> { audio, url }
    this.ticker = null;
  }

  /** Hay que llamarlo dentro de un toque/click: los navegadores exigen un gesto para habilitar el audio. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC({ latencyHint: 'interactive' });
    }
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  isRunning(id) {
    return this.running.has(id);
  }

  /** Carga por adelantado el cue en espera para que el GO sea instantáneo. */
  prepare(cue) {
    if (!cue || cue.kind !== 'audio' || !cue.blob || this.prepared.has(cue.id) || this.running.has(cue.id)) return;
    const url = URL.createObjectURL(cue.blob);
    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = url;
    this.prepared.set(cue.id, { audio, url });
    while (this.prepared.size > 4) {
      const [id, p] = this.prepared.entries().next().value;
      this.prepared.delete(id);
      release(p.audio, p.url);
    }
  }

  /** Dispara un cue. Un cue de blackout corta (o funde) todo lo que esté sonando. */
  fire(cue, { preview = false } = {}) {
    this.unlock();
    if (this.running.has(cue.id)) this.finish(cue.id, false);

    if (cue.kind === 'stop') {
      const fade = Math.max(0, cue.fade || 0);
      this.stopAll(fade);
      const run = { cue, preview, startedAt: performance.now(), duration: fade };
      run.timer = setTimeout(() => this.finish(cue.id, true), fade * 1000);
      this.running.set(cue.id, run);
      this.startTicker();
      return;
    }
    if (!cue.blob) {
      this.onError('Este cue no tiene audio.');
      return;
    }

    let p = this.prepared.get(cue.id);
    this.prepared.delete(cue.id);
    if (!p) {
      const url = URL.createObjectURL(cue.blob);
      p = { audio: new Audio(url), url };
    }
    const { audio, url } = p;
    const target = dbToGain(cue.db);
    const start = Math.max(0, cue.start || 0);
    const run = { cue, preview, audio, url, target, start, gain: null, node: null, fading: false, stopping: false };

    if (this.ctx) {
      run.node = this.ctx.createMediaElementSource(audio);
      run.gain = this.ctx.createGain();
      run.node.connect(run.gain).connect(this.ctx.destination);
      const now = this.ctx.currentTime;
      run.gain.gain.setValueAtTime(cue.fadeIn > 0 ? 0 : target, now);
      if (cue.fadeIn > 0) run.gain.gain.linearRampToValueAtTime(target, now + cue.fadeIn);
    } else {
      audio.volume = cue.fadeIn > 0 ? 0 : Math.min(1, target);
      if (cue.fadeIn > 0) this.ramp(run, target, cue.fadeIn);
    }

    // Loop nativo (sin cortes) cuando no hay recorte; con recorte lo maneja el ticker.
    audio.loop = !!cue.loop && !start && !cue.end;
    if (start) audio.currentTime = start;
    audio.addEventListener('loadedmetadata', () => {
      if (start && audio.currentTime < start - 0.2) audio.currentTime = start;
    });
    audio.addEventListener('ended', () => this.naturalEnd(run));
    audio.addEventListener('error', () => {
      if (this.running.get(cue.id) !== run) return;
      this.finish(cue.id, false);
      this.onError(`No se pudo reproducir “${cue.name}”. ¿El formato es compatible con este navegador?`);
    });

    this.running.set(cue.id, run);
    audio.play().catch((e) => {
      if (this.running.get(cue.id) !== run || e.name === 'AbortError') return;
      this.finish(cue.id, false);
      this.onError(e.name === 'NotAllowedError' ? 'El navegador bloqueó el audio: tocá GO de nuevo.' : `No se pudo reproducir “${cue.name}”.`);
    });
    this.startTicker();
  }

  /** Frena un cue, con fundido opcional (segundos). */
  stop(id, fade = 0) {
    const run = this.running.get(id);
    if (!run) return;
    if (!(fade > 0) || !run.audio) return this.finish(id, false);
    if (run.stopping) return;
    run.stopping = true;
    this.ramp(run, 0, fade);
    run.timer = setTimeout(() => this.finish(id, false), fade * 1000);
  }

  stopAll(fade = 0) {
    for (const id of [...this.running.keys()]) this.stop(id, fade);
  }

  /** Estado para la interfaz. */
  runs() {
    return [...this.running.values()].map((run) => {
      const { cue } = run;
      if (!run.audio) {
        const elapsed = (performance.now() - run.startedAt) / 1000;
        return { cue, elapsed, duration: run.duration, remaining: Math.max(0, run.duration - elapsed), stopping: false, preview: run.preview };
      }
      const total = Number.isFinite(run.audio.duration) ? run.audio.duration : cue.duration;
      const end = cue.end && cue.end > run.start ? Math.min(cue.end, total || cue.end) : total;
      const duration = Number.isFinite(end) ? end - run.start : null;
      const elapsed = Math.max(0, run.audio.currentTime - run.start);
      return {
        cue, elapsed, duration, remaining: duration === null ? null : Math.max(0, duration - elapsed),
        stopping: run.stopping || run.fading, preview: run.preview,
      };
    });
  }

  // ---------- interno ----------

  ramp(run, to, seconds) {
    if (run.gain) {
      const g = run.gain.gain;
      const now = this.ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(to, now + Math.max(0.01, seconds));
      return;
    }
    clearInterval(run.rampTimer);
    const from = run.audio.volume;
    const t0 = performance.now();
    run.rampTimer = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / (seconds * 1000));
      run.audio.volume = Math.max(0, Math.min(1, from + (Math.min(1, to) - from) * k));
      if (k >= 1) clearInterval(run.rampTimer);
    }, TICK_MS);
  }

  naturalEnd(run) {
    if (this.running.get(run.cue.id) !== run || run.stopping) return;
    if (run.cue.loop) {
      run.audio.currentTime = run.start;
      run.audio.play().catch(() => {});
      return;
    }
    this.finish(run.cue.id, true);
  }

  finish(id, natural) {
    const run = this.running.get(id);
    if (!run) return;
    this.running.delete(id);
    clearTimeout(run.timer);
    clearInterval(run.rampTimer);
    if (run.audio) {
      try { run.node?.disconnect(); run.gain?.disconnect(); } catch { /* ya desconectado */ }
      release(run.audio, run.url);
    }
    this.onEnded(run.cue, natural, run.preview);
    this.onTick();
  }

  startTicker() {
    if (this.ticker) return;
    this.ticker = setInterval(() => this.tick(), TICK_MS);
  }

  tick() {
    if (!this.running.size) {
      clearInterval(this.ticker);
      this.ticker = null;
      this.onTick();
      return;
    }
    for (const run of [...this.running.values()]) {
      if (!run.audio || run.stopping) continue;
      const { cue, audio } = run;
      const t = audio.currentTime;
      if (cue.end && cue.end > run.start && t >= cue.end) {
        this.naturalEnd(run);
        continue;
      }
      // Fundido de salida automático antes del final (no aplica en loop).
      if (cue.fadeOut > 0 && !cue.loop && !run.fading) {
        const endAt = cue.end && cue.end > run.start ? cue.end : audio.duration;
        if (Number.isFinite(endAt) && endAt - t <= cue.fadeOut && t > run.start) {
          run.fading = true;
          this.ramp(run, 0, Math.max(0.05, endAt - t));
        }
      }
    }
    this.onTick();
  }
}

function release(audio, url) {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  if (url) URL.revokeObjectURL(url);
}
