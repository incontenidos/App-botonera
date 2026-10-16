// Modo Función: lista de cues para pasar el sonido de una obra con un botón GO.

import { getAllShows, putShow, deleteShow } from './db.js?v=1.3';
import { ShowEngine } from './show-engine.js?v=1.3';
import {
  CONTINUE, clampDb, formatDb, goFrom, followAfter, effectiveDuration, clock,
} from './cues.js?v=1.3';
import { parseTime, formatTime, isAudioFile, guessMime } from './sources.js?v=1.3';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

const CONTINUE_LABEL = {
  [CONTINUE.WAIT]: { icon: '✋', text: 'Espera GO', title: 'Espera el próximo GO' },
  [CONTINUE.FOLLOW]: { icon: '↳', text: 'Continuado', title: 'Al terminar, entra el siguiente' },
  [CONTINUE.AUTO]: { icon: '⇉', text: 'Junto al siguiente', title: 'El siguiente entra junto con este' },
};

const safeStorage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* modo privado */ } },
};

/**
 * @param {object} deps
 * @param {(msg:string)=>void} deps.toast
 * @param {()=>object[]} deps.getSounds sonidos de la botonera (para "Desde la botonera")
 */
export function initShow({ toast, getSounds }) {
  const els = {
    view: $('#show-view'),
    select: $('#show-select'),
    list: $('#cue-list'),
    empty: $('#show-empty'),
    go: $('#go-btn'),
    standbyName: $('#standby-name'),
    standbyMeta: $('#standby-meta'),
    running: $('#running'),
    editToggle: $('#show-edit-toggle'),
    cueDialog: $('#cue-dialog'),
    cueForm: $('#cue-form'),
    pickDialog: $('#pick-dialog'),
    fileInput: $('#cue-file-input'),
    importInput: $('#show-import-input'),
    fadeAllSecs: $('#fade-all-secs'),
  };

  const state = {
    shows: [],
    show: null,
    standby: 0,
    editing: false,
    draft: null, // copia del cue que se está editando
    lastGo: -Infinity,
    wakeLock: null,
    active: false,
  };

  const engine = new ShowEngine({
    onEnded: onCueEnded,
    onTick: renderRunning,
    onError: toast,
  });

  els.fadeAllSecs.value = safeStorage.get('botonera.fadeAll') || '3';
  const fadeAllSeconds = () => Math.max(0.5, Number(els.fadeAllSecs.value) || 3);

  // ---------- Datos ----------

  async function load() {
    state.shows = await getAllShows();
    if (!state.shows.length) {
      const show = newShow('Mi función');
      await putShow(show);
      state.shows = [show];
    }
    const last = safeStorage.get('botonera.show');
    selectShow(state.shows.find((s) => s.id === last) || state.shows[0]);
  }

  function newShow(name) {
    return { id: uid(), name, createdAt: Date.now(), cues: [] };
  }

  function save() {
    return putShow(state.show).catch((e) => {
      console.error(e);
      toast('No se pudo guardar la función (¿falta espacio?)');
    });
  }

  function selectShow(show) {
    engine.stopAll(0);
    state.show = show;
    state.standby = 0;
    safeStorage.set('botonera.show', show.id);
    renderSelect();
    render();
  }

  function cueFromFile(file) {
    return {
      id: uid(),
      kind: 'audio',
      name: file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim() || 'Audio',
      fileName: file.name,
      blob: new Blob([file], { type: guessMime(file) }),
      db: 0, fadeIn: 0, fadeOut: 0, start: null, end: null, loop: false,
      continue: CONTINUE.WAIT,
      duration: null,
    };
  }

  function stopCue() {
    return { id: uid(), kind: 'stop', name: 'BLACKOUT', fade: 0, continue: CONTINUE.WAIT };
  }

  function measure(cue) {
    return new Promise((resolve) => {
      if (!cue.blob) return resolve();
      const url = URL.createObjectURL(cue.blob);
      const a = new Audio();
      a.preload = 'metadata';
      const end = () => { URL.revokeObjectURL(url); resolve(); };
      a.onloadedmetadata = () => {
        if (Number.isFinite(a.duration)) cue.duration = Math.round(a.duration * 10) / 10;
        end();
      };
      a.onerror = end;
      a.src = url;
      setTimeout(end, 8000);
    });
  }

  /** Inserta cues después del que está seleccionado (o al final). */
  async function insertCues(cues) {
    if (!cues.length) return;
    await Promise.all(cues.map(measure));
    const at = state.show.cues.length;
    state.show.cues.splice(at, 0, ...cues);
    await save();
    render();
    toast(cues.length === 1 ? `Cue “${cues[0].name}” agregado` : `${cues.length} cues agregados`);
  }

  async function addFiles(files) {
    const audio = files.filter(isAudioFile);
    if (!audio.length) return toast('Esos archivos no parecen audios.');
    // Orden alfabético: los audios de una obra suelen venir numerados (01, 02…).
    audio.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
    await insertCues(audio.map(cueFromFile));
  }

  // ---------- Reproducción ----------

  function go() {
    const now = performance.now();
    if (now - state.lastGo < 300) return; // evita doble GO por un toque nervioso
    state.lastGo = now;
    engine.unlock();
    const { cues } = state.show;
    if (state.standby >= cues.length) {
      flash(els.go);
      return toast('Llegaste al final de la lista.');
    }
    const { fire, next } = goFrom(cues, state.standby);
    fire.forEach((i) => engine.fire(cues[i]));
    setStandby(next);
    flash(els.go);
  }

  function onCueEnded(cue, natural, preview) {
    if (preview) renderPreviewBtn();
    if (!natural || preview || !state.show) return renderRows();
    const idx = state.show.cues.findIndex((c) => c.id === cue.id);
    const f = followAfter(state.show.cues, idx);
    if (f !== null) {
      const { fire, next } = goFrom(state.show.cues, f);
      fire.forEach((i) => engine.fire(state.show.cues[i]));
      if (state.standby === f) setStandby(next);
    }
    renderRows();
  }

  function setStandby(i) {
    const max = state.show.cues.length;
    state.standby = Math.max(0, Math.min(max, i));
    engine.prepare(state.show.cues[state.standby]);
    renderStandby();
    renderRows();
    const row = els.list.children[state.standby];
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function fadeAll() {
    engine.stopAll(fadeAllSeconds());
  }

  function stopAll() {
    engine.stopAll(0);
  }

  function flash(el) {
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  // ---------- Render ----------

  function renderSelect() {
    els.select.replaceChildren(...state.shows.map((s) => {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.name;
      o.selected = s.id === state.show?.id;
      return o;
    }));
  }

  function cueMeta(cue) {
    if (cue.kind === 'stop') return cue.fade ? `Funde todo en ${cue.fade} s` : 'Corta todo';
    const bits = [];
    if (cue.start || cue.end) bits.push(`${formatTime(cue.start || 0)}–${cue.end ? formatTime(cue.end) : 'fin'}`);
    if (cue.fadeIn) bits.push(`entra en ${cue.fadeIn} s`);
    if (cue.fadeOut) bits.push(`sale en ${cue.fadeOut} s`);
    return bits.join(' · ');
  }

  function render() {
    if (state.show && !state.show.cues.length) state.editing = true;
    renderRows();
    renderStandby();
    renderRunning();
    els.view.classList.toggle('editing-show', state.editing);
    els.editToggle.setAttribute('aria-pressed', String(state.editing));
  }

  function renderRows() {
    if (!state.show) return;
    const { cues } = state.show;
    els.empty.hidden = cues.length > 0;
    els.list.replaceChildren(...cues.map((cue, i) => {
      const li = document.createElement('li');
      li.className = `cue cue-${cue.kind}`;
      li.dataset.id = cue.id;
      li.draggable = state.editing;
      if (i === state.standby) li.classList.add('standby');
      if (engine.isRunning(cue.id)) li.classList.add('running');
      const cont = CONTINUE_LABEL[cue.continue] || CONTINUE_LABEL.wait;
      const cells = [
        ['cue-num', String(i + 1)],
        ['cue-desc', null],
        ['cue-dur', `⏱ ${clock(effectiveDuration(cue))}`],
        ['cue-db', cue.kind === 'stop' ? '' : `🔊 ${formatDb(cue.db)}`],
        ['cue-loop', cue.loop ? '🔁 Loop' : ''],
        ['cue-cont', `${cont.icon} ${cont.text}`],
      ];
      for (const [cls, text] of cells) {
        const span = document.createElement('span');
        span.className = cls;
        if (cls === 'cue-cont') {
          const icon = document.createElement('b');
          icon.textContent = cont.icon;
          const label = document.createElement('i');
          label.textContent = cont.text;
          span.append(icon, ' ', label);
        } else if (cls === 'cue-desc') {
          const name = document.createElement('strong');
          name.textContent = `${cue.kind === 'stop' ? '⏹ ' : '♪ '}${cue.name}`;
          const meta = document.createElement('small');
          meta.textContent = cueMeta(cue);
          span.append(name, meta);
        } else {
          span.textContent = text;
        }
        if (cls === 'cue-cont') span.title = cont.title;
        if (cls === 'cue-db' && clampDb(cue.db) !== 0) span.classList.add(cue.db > 0 ? 'up' : 'down');
        li.append(span);
      }
      const bar = document.createElement('span');
      bar.className = 'cue-bar';
      li.append(bar);
      return li;
    }));
    renderRunning();
  }

  function renderStandby() {
    const cue = state.show?.cues[state.standby];
    els.standbyName.textContent = cue ? `${state.standby + 1}. ${cue.name}` : 'Fin de la lista';
    els.standbyMeta.textContent = cue
      ? [cue.kind === 'stop' ? 'Blackout' : clock(effectiveDuration(cue)), cue.kind === 'stop' ? '' : formatDb(cue.db), cue.loop ? '🔁 loop' : '', CONTINUE_LABEL[cue.continue]?.title || '']
        .filter(Boolean).join(' · ')
      : 'Elegí un cue de la lista para volver a empezar.';
    els.go.disabled = !cue;
  }

  function renderRunning() {
    if (!state.show) return;
    const runs = engine.runs().filter((r) => !r.preview);
    // barra de progreso en la fila
    for (const li of els.list.children) {
      const run = runs.find((r) => r.cue.id === li.dataset.id);
      li.classList.toggle('running', !!run);
      li.style.setProperty('--p', run && run.duration ? String(Math.min(1, run.elapsed / run.duration)) : '0');
    }
    els.running.replaceChildren(...runs.map((r) => {
      const div = document.createElement('div');
      div.className = `run${r.stopping ? ' stopping' : ''}${r.cue.kind === 'stop' ? ' run-stop' : ''}`;
      div.style.setProperty('--p', r.duration ? String(Math.min(1, r.elapsed / r.duration)) : '0');
      const name = document.createElement('span');
      name.className = 'run-name';
      name.textContent = `${r.cue.loop ? '🔁 ' : ''}${r.cue.name}`;
      const time = document.createElement('span');
      time.className = 'run-time';
      time.textContent = r.cue.loop ? clock(r.elapsed) : `−${clock(r.remaining)}`;
      div.append(name, time);
      if (r.cue.kind !== 'stop') {
        const fade = document.createElement('button');
        fade.className = 'icon-btn small';
        fade.textContent = '↘';
        fade.title = 'Fundir este';
        fade.addEventListener('click', () => engine.stop(r.cue.id, fadeAllSeconds()));
        const stop = document.createElement('button');
        stop.className = 'icon-btn small';
        stop.textContent = '⏹';
        stop.title = 'Parar este';
        stop.addEventListener('click', () => engine.stop(r.cue.id, 0));
        div.append(fade, stop);
      }
      return div;
    }));
  }

  // ---------- Edición de cues ----------

  function openCue(cue) {
    state.draft = { ...cue };
    const f = els.cueForm.elements;
    f.name.value = cue.name;
    f.db.value = clampDb(cue.db);
    f.fadeIn.value = cue.fadeIn || '';
    f.fadeOut.value = cue.fadeOut || '';
    f.start.value = cue.start ? formatTime(cue.start) : '';
    f.end.value = cue.end ? formatTime(cue.end) : '';
    f.loop.checked = !!cue.loop;
    f.fade.value = cue.fade || '';
    f.continue.value = cue.continue || CONTINUE.WAIT;
    els.cueForm.classList.toggle('is-stop', cue.kind === 'stop');
    const idx = state.show.cues.findIndex((c) => c.id === cue.id);
    $('#cue-title').textContent = `Cue ${idx + 1}`;
    $('#cue-source').textContent = cue.kind === 'stop'
      ? 'Blackout sonoro'
      : `📁 ${cue.fileName || 'audio'}${cue.duration ? ` · ${clock(cue.duration)}` : ''}`;
    updateDbOut();
    updateLoopHint();
    renderPreviewBtn();
    els.cueDialog.showModal();
  }

  function readCue() {
    const f = els.cueForm.elements;
    const d = state.draft;
    const num = (v) => {
      const n = parseTime(v);
      return n && n > 0 ? n : 0;
    };
    d.name = f.name.value.trim() || (d.kind === 'stop' ? 'BLACKOUT' : 'Sin nombre');
    d.continue = f.continue.value;
    if (d.kind === 'stop') {
      d.fade = num(f.fade.value);
    } else {
      d.db = clampDb(f.db.value);
      d.fadeIn = num(f.fadeIn.value);
      d.fadeOut = num(f.fadeOut.value);
      d.start = parseTime(f.start.value) || null;
      d.end = parseTime(f.end.value) || null;
      if (d.end && d.start && d.end <= d.start) d.end = null;
      d.loop = f.loop.checked;
    }
    return d;
  }

  function updateDbOut() {
    $('#db-out').textContent = formatDb(els.cueForm.elements.db.value);
  }

  function updateLoopHint() {
    const f = els.cueForm.elements;
    $('#loop-follow-hint').hidden = !(f.loop.checked && f.continue.value === CONTINUE.FOLLOW && state.draft?.kind !== 'stop');
  }

  const previewId = () => `preview-${state.draft?.id}`;

  function renderPreviewBtn() {
    $('#cue-preview').textContent = engine.isRunning(previewId()) ? '⏹ Parar' : '▶ Probar';
  }

  async function moveCue(id, delta) {
    const cues = state.show.cues;
    const i = cues.findIndex((c) => c.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= cues.length) return;
    const [c] = cues.splice(i, 1);
    cues.splice(j, 0, c);
    if (state.standby === i) state.standby = j;
    else if (state.standby === j) state.standby = i;
    await save();
    render();
    $('#cue-title').textContent = `Cue ${j + 1}`;
  }

  // ---------- Exportar / importar ----------

  const toDataUrl = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

  async function exportShow() {
    toast('Preparando el archivo…');
    const cues = await Promise.all(state.show.cues.map(async (c) => ({ ...c, blob: c.blob ? await toDataUrl(c.blob) : undefined })));
    const data = { app: 'botonera-funcion', version: 1, exportedAt: new Date().toISOString(), show: { ...state.show, cues } };
    const file = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = `funcion-${state.show.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function importShow(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'botonera-funcion' || !Array.isArray(data.show?.cues)) throw new Error('formato');
      const cues = await Promise.all(data.show.cues.map(async (c) => ({
        ...c, id: uid(), blob: c.blob ? await (await fetch(c.blob)).blob() : undefined,
      })));
      const show = { id: uid(), name: data.show.name || 'Función importada', createdAt: Date.now(), cues };
      await putShow(show);
      state.shows.push(show);
      selectShow(show);
      toast(`Se importó “${show.name}” (${cues.length} cues).`);
    } catch (e) {
      console.error(e);
      toast('Ese archivo no es una función válida.');
    }
  }

  // ---------- Pantalla siempre encendida durante la función ----------

  async function keepAwake() {
    if (!state.active || !('wakeLock' in navigator) || state.wakeLock) return;
    try {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
    } catch { /* no disponible */ }
  }

  // ---------- Eventos ----------

  els.go.addEventListener('click', (e) => {
    go();
    e.currentTarget.blur(); // así la barra espaciadora no lo vuelve a "clickear"
  });
  $('#prev-btn').addEventListener('click', () => setStandby(state.standby - 1));
  $('#next-btn').addEventListener('click', () => setStandby(state.standby + 1));
  $('#fade-all-btn').addEventListener('click', fadeAll);
  $('#stop-show-btn').addEventListener('click', stopAll);
  els.fadeAllSecs.addEventListener('change', () => safeStorage.set('botonera.fadeAll', String(fadeAllSeconds())));

  els.select.addEventListener('change', () => {
    const show = state.shows.find((s) => s.id === els.select.value);
    if (show) selectShow(show);
  });
  $('#show-new').addEventListener('click', async () => {
    const name = prompt('Nombre de la función / obra:', 'Nueva función');
    if (!name?.trim()) return;
    const show = newShow(name.trim());
    await putShow(show);
    state.shows.push(show);
    selectShow(show);
    state.editing = true;
    render();
  });
  els.editToggle.addEventListener('click', () => {
    state.editing = !state.editing;
    render();
  });

  document.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-show-action]')?.dataset.showAction;
    if (!action) return;
    $('#menu').hidden = true;
    if (action === 'rename') {
      const name = prompt('Nuevo nombre:', state.show.name);
      if (!name?.trim()) return;
      state.show.name = name.trim();
      await save();
      renderSelect();
    }
    if (action === 'export') exportShow();
    if (action === 'import') els.importInput.click();
    if (action === 'delete') {
      if (!confirm(`¿Borrar la función “${state.show.name}” y todos sus cues?`)) return;
      engine.stopAll(0);
      await deleteShow(state.show.id);
      state.shows = state.shows.filter((s) => s.id !== state.show.id);
      if (!state.shows.length) {
        const show = newShow('Mi función');
        await putShow(show);
        state.shows = [show];
      }
      selectShow(state.shows[0]);
    }
  });

  // Filas: tocar = dejar en espera; en edición = abrir el cue.
  els.list.addEventListener('click', (e) => {
    const li = e.target.closest('.cue');
    if (!li) return;
    const i = state.show.cues.findIndex((c) => c.id === li.dataset.id);
    if (state.editing) openCue(state.show.cues[i]);
    else setStandby(i);
  });

  // Ordenar arrastrando (modo edición)
  els.list.addEventListener('dragstart', (e) => {
    const li = e.target.closest('.cue');
    if (!li || !state.editing) return;
    e.dataTransfer.setData('text/x-cue-id', li.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    li.classList.add('dragging');
  });
  els.list.addEventListener('dragend', (e) => e.target.closest('.cue')?.classList.remove('dragging'));
  els.list.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('text/x-cue-id')) e.preventDefault();
  });
  els.list.addEventListener('drop', async (e) => {
    const id = e.dataTransfer.getData('text/x-cue-id');
    const target = e.target.closest('.cue');
    if (!id || !target) return;
    e.preventDefault();
    e.stopPropagation();
    const cues = state.show.cues;
    const from = cues.findIndex((c) => c.id === id);
    const to = cues.findIndex((c) => c.id === target.dataset.id);
    const standbyId = cues[state.standby]?.id;
    const [c] = cues.splice(from, 1);
    cues.splice(to, 0, c);
    if (standbyId) state.standby = cues.findIndex((x) => x.id === standbyId);
    await save();
    render();
  });

  $('#add-cue-files').addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', () => {
    const files = [...els.fileInput.files];
    els.fileInput.value = '';
    addFiles(files);
  });
  $('#add-cue-stop').addEventListener('click', () => insertCues([stopCue()]));
  $('#add-cue-board').addEventListener('click', () => {
    const sounds = getSounds().filter((s) => s.blob);
    if (!sounds.length) return toast('No hay audios guardados en la botonera.');
    $('#pick-list').replaceChildren(...sounds.map((s) => {
      const label = document.createElement('label');
      label.className = 'pick';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = s.id;
      const txt = document.createElement('span');
      txt.textContent = `${s.emoji || '🔊'} ${s.name}`;
      label.append(cb, txt);
      return label;
    }));
    els.pickDialog.showModal();
  });
  $('#pick-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const ids = $$('#pick-list input:checked').map((cb) => cb.value);
    const sounds = getSounds().filter((s) => ids.includes(s.id));
    els.pickDialog.close();
    insertCues(sounds.map((s) => ({
      id: uid(), kind: 'audio', name: s.name, fileName: s.fileName || s.name, blob: s.blob,
      db: s.volume && s.volume < 1 ? clampDb(20 * Math.log10(s.volume)) : 0,
      fadeIn: 0, fadeOut: 0, start: s.start || null, end: s.end || null, loop: !!s.loop,
      continue: CONTINUE.WAIT, duration: null,
    })));
  });

  els.importInput.addEventListener('change', () => {
    const [file] = els.importInput.files;
    els.importInput.value = '';
    if (file) importShow(file);
  });

  // Diálogo de cue
  for (const d of [els.cueDialog, els.pickDialog]) {
    d.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]') || e.target === d) d.close();
    });
  }
  els.cueDialog.addEventListener('close', () => {
    engine.stop(previewId(), 0);
    state.draft = null;
  });
  els.cueForm.addEventListener('input', (e) => {
    if (e.target.name === 'db') updateDbOut();
    updateLoopHint();
  });
  for (const b of $$('[data-db]', els.cueForm)) {
    b.addEventListener('click', () => {
      const f = els.cueForm.elements;
      f.db.value = clampDb(Number(f.db.value) + Number(b.dataset.db));
      updateDbOut();
    });
  }
  $('#cue-preview').addEventListener('click', () => {
    if (!state.draft) return;
    if (engine.isRunning(previewId())) {
      engine.stop(previewId(), 0);
    } else {
      const cue = { ...readCue(), id: previewId(), continue: CONTINUE.WAIT };
      if (cue.kind === 'stop') return toast('El blackout se prueba dándole GO en la lista.');
      engine.fire(cue, { preview: true });
    }
    renderPreviewBtn();
  });
  for (const b of $$('[data-cue-move]', els.cueForm)) {
    b.addEventListener('click', () => state.draft && moveCue(state.draft.id, Number(b.dataset.cueMove)));
  }
  $('#cue-duplicate').addEventListener('click', async () => {
    const d = readCue();
    const i = state.show.cues.findIndex((c) => c.id === d.id);
    const copy = { ...d, id: uid(), name: `${d.name} (copia)` };
    state.show.cues.splice(i + 1, 0, copy);
    await save();
    els.cueDialog.close();
    render();
    toast('Cue duplicado');
  });
  $('#cue-delete').addEventListener('click', async () => {
    const d = state.draft;
    if (!d || !confirm(`¿Borrar el cue “${d.name}”?`)) return;
    engine.stop(d.id, 0);
    const i = state.show.cues.findIndex((c) => c.id === d.id);
    state.show.cues.splice(i, 1);
    if (state.standby > i) state.standby--;
    await save();
    els.cueDialog.close();
    render();
  });
  els.cueForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = readCue();
    const i = state.show.cues.findIndex((c) => c.id === d.id);
    if (i >= 0) state.show.cues[i] = d;
    await save();
    els.cueDialog.close();
    render();
  });

  // Teclado de la función
  document.addEventListener('keydown', (e) => {
    if (!state.active || $$('dialog').some((d) => d.open) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select')) return;
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      if (!e.repeat) go();
    } else if (e.key === 'Escape') {
      stopAll();
    } else if (e.key === 'f' || e.key === 'F') {
      fadeAll();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setStandby(state.standby + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setStandby(state.standby - 1);
    }
  });
  document.addEventListener('keyup', (e) => {
    if (state.active && (e.code === 'Space' || e.key === ' ') && !e.target.closest?.('input, textarea, select')) e.preventDefault();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') keepAwake();
  });

  const ready = load().catch((e) => {
    console.error(e);
    toast('No se pudieron cargar las funciones.');
  });

  return {
    async enter() {
      await ready;
      state.active = true;
      keepAwake();
      engine.prepare(state.show?.cues[state.standby]);
      render();
    },
    leave() {
      state.active = false;
      state.wakeLock?.release().catch(() => {});
      state.wakeLock = null;
    },
    async addFiles(files) {
      await ready;
      return addFiles(files);
    },
  };
}
