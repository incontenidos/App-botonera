// Reproductor: audios locales con <audio> (pueden sonar varios a la vez) y
// YouTube / Spotify con sus reproductores oficiales embebidos (de a uno, visibles en el "dock").

function loadScript(src, globalCallback, getApi) {
  return new Promise((resolve, reject) => {
    const ready = getApi();
    if (ready) return resolve(ready);
    const prev = window[globalCallback];
    window[globalCallback] = (...args) => {
      prev?.(...args);
      resolve(getApi() || args[0]);
    };
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onerror = () => reject(new Error('No se pudo cargar el reproductor. ¿Hay conexión a internet?'));
    document.head.append(s);
  });
}

let ytApi;
const loadYouTube = () =>
  (ytApi ??= loadScript('https://www.youtube.com/iframe_api', 'onYouTubeIframeAPIReady', () => window.YT?.Player && window.YT)
    .catch((e) => { ytApi = null; throw e; }));

let spotifyApi;
const loadSpotify = () =>
  (spotifyApi ??= loadScript('https://open.spotify.com/embed/iframe-api/v1', 'onSpotifyIframeApiReady', () => null)
    .catch((e) => { spotifyApi = null; throw e; }));

export class Player {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.dock contenedor visible para YouTube/Spotify
   * @param {(id:string, playing:boolean, progress?:number)=>void} opts.onChange
   * @param {(msg:string)=>void} opts.onError
   */
  constructor({ dock, onChange, onError }) {
    this.dock = dock;
    this.onChange = onChange;
    this.onError = onError;
    this.overlap = true;
    this.local = new Map(); // id -> { audio, url }
    this.embed = null; // { id, kind, sound }
    this.yt = null;
    this.sp = null;
    dock.querySelector('[data-dock-close]').addEventListener('click', () => this.stopEmbed());
  }

  isPlaying(id) {
    return this.local.has(id) || this.embed?.id === id;
  }

  toggle(sound) {
    if (this.isPlaying(sound.id)) this.stop(sound.id);
    else this.play(sound);
  }

  play(sound) {
    if (!this.overlap) this.stopAll();
    if (sound.kind === 'youtube' || sound.kind === 'spotify') {
      this.stopEmbed();
      this.embed = { id: sound.id, kind: sound.kind, sound, pendingSeek: !!sound.start };
      this.onChange(sound.id, true, 0);
      this.showDock(sound);
      const run = sound.kind === 'youtube' ? this.playYouTube(sound) : this.playSpotify(sound);
      run.catch((e) => {
        this.onError(e.message);
        this.stopEmbed();
      });
    } else {
      this.playLocal(sound);
    }
  }

  stop(id) {
    const entry = this.local.get(id);
    if (entry) {
      entry.audio.pause();
      entry.audio.removeAttribute('src');
      if (entry.url) URL.revokeObjectURL(entry.url);
      this.local.delete(id);
      this.onChange(id, false);
    }
    if (this.embed?.id === id) this.stopEmbed();
  }

  stopAll() {
    [...this.local.keys()].forEach((id) => this.stop(id));
    this.stopEmbed();
  }

  // ---------- Audio local / link directo ----------

  playLocal(sound) {
    this.stop(sound.id);
    const url = sound.blob ? URL.createObjectURL(sound.blob) : null;
    const audio = new Audio(url || sound.url);
    audio.preload = 'auto';
    audio.volume = sound.volume ?? 1;
    audio.loop = false;
    const start = sound.start || 0;
    const end = sound.end || null;
    if (start) audio.currentTime = start;
    this.local.set(sound.id, { audio, url });

    const seekToStart = () => {
      if (start && Math.abs(audio.currentTime - start) > 0.25 && audio.currentTime < start) audio.currentTime = start;
    };
    audio.addEventListener('loadedmetadata', seekToStart);
    audio.addEventListener('timeupdate', () => {
      if (!this.local.has(sound.id)) return;
      const stopAt = end || audio.duration;
      if (end && audio.currentTime >= end) return this.finish(sound);
      if (Number.isFinite(stopAt) && stopAt > start) {
        this.onChange(sound.id, true, (audio.currentTime - start) / (stopAt - start));
      }
    });
    audio.addEventListener('ended', () => this.finish(sound));
    audio.addEventListener('error', () => {
      if (!this.local.has(sound.id)) return;
      this.stop(sound.id);
      this.onError(sound.kind === 'url'
        ? 'No se pudo reproducir el link. Puede que el sitio no permita usarlo o no sea un audio.'
        : 'Este navegador no puede reproducir ese formato de audio.');
    });

    this.onChange(sound.id, true, 0);
    audio.play().catch((e) => {
      if (e.name === 'AbortError' || !this.local.has(sound.id)) return;
      this.stop(sound.id);
      this.onError(e.name === 'NotAllowedError' ? 'El navegador bloqueó la reproducción. Tocá el botón de nuevo.' : 'No se pudo reproducir el audio.');
    });
  }

  finish(sound) {
    if (sound.loop && this.local.has(sound.id)) {
      const { audio } = this.local.get(sound.id);
      audio.currentTime = sound.start || 0;
      audio.play().catch(() => this.stop(sound.id));
      return;
    }
    this.stop(sound.id);
  }

  // ---------- Dock para YouTube / Spotify ----------

  showDock(sound) {
    this.dock.hidden = false;
    this.dock.dataset.kind = sound.kind;
    this.dock.querySelector('[data-dock-title]').textContent = `${sound.emoji || ''} ${sound.name}`.trim();
  }

  stopEmbed() {
    if (!this.embed) {
      this.dock.hidden = true;
      return;
    }
    const { id, kind } = this.embed;
    this.embed = null;
    try {
      if (kind === 'youtube') this.yt?.pauseVideo?.();
      if (kind === 'spotify') this.sp?.pause?.();
    } catch { /* el reproductor puede no estar listo */ }
    this.dock.hidden = true;
    this.onChange(id, false);
  }

  async playYouTube(sound) {
    const YT = await loadYouTube();
    if (this.embed?.id !== sound.id) return;
    const volume = Math.round((sound.volume ?? 1) * 100);
    if (!this.yt) {
      await new Promise((resolve) => {
        this.yt = new YT.Player(this.dock.querySelector('[data-yt]'), {
          width: '100%',
          height: '100%',
          videoId: sound.videoId,
          playerVars: {
            autoplay: 1, playsinline: 1, rel: 0,
            start: Math.floor(sound.start || 0),
            ...(sound.end ? { end: Math.ceil(sound.end) } : {}),
          },
          events: {
            onReady: () => resolve(),
            onStateChange: (e) => this.onYouTubeState(e.data),
            onError: () => {
              this.onError('YouTube no permite reproducir este video fuera de su sitio.');
              this.stopEmbed();
            },
          },
        });
      });
      if (this.embed?.id !== sound.id) return;
      this.yt.setVolume(volume);
      this.yt.playVideo();
    } else {
      this.yt.setVolume(volume);
      this.yt.loadVideoById({ videoId: sound.videoId, startSeconds: sound.start || 0, ...(sound.end ? { endSeconds: sound.end } : {}) });
    }
  }

  onYouTubeState(state) {
    if (this.embed?.kind !== 'youtube') return;
    const { sound } = this.embed;
    if (state === 0) {
      // ENDED: con loop vuelve a empezar; si no, se cierra.
      if (sound.loop) this.yt.seekTo(sound.start || 0, true);
      else this.stopEmbed();
    }
  }

  async playSpotify(sound) {
    const api = await loadSpotify();
    if (this.embed?.id !== sound.id) return;
    if (!this.sp) {
      await new Promise((resolve) => {
        api.createController(this.dock.querySelector('[data-spotify]'), { uri: sound.uri, width: '100%', height: 152 }, (controller) => {
          this.sp = controller;
          controller.addListener('ready', resolve);
          controller.addListener('playback_update', (e) => this.onSpotifyUpdate(e.data));
        });
      });
    } else {
      this.sp.loadUri(sound.uri);
    }
    if (this.embed?.id !== sound.id) return;
    this.sp.play();
  }

  onSpotifyUpdate(data) {
    if (this.embed?.kind !== 'spotify' || !data) return;
    const { sound } = this.embed;
    const pos = data.position / 1000;
    const start = sound.start || 0;
    if (this.embed.pendingSeek && !data.isPaused && data.position > 0) {
      this.embed.pendingSeek = false;
      if (pos < start - 0.5) this.sp.seek(start);
      return;
    }
    const end = sound.end || data.duration / 1000;
    if (sound.end && pos >= sound.end) {
      if (sound.loop) this.sp.seek(start);
      else this.stopEmbed();
      return;
    }
    if (end > start) this.onChange(sound.id, true, Math.min(1, Math.max(0, (pos - start) / (end - start))));
  }
}
