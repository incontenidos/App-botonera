import { getAllSounds, putSounds, deleteSound, takeInbox } from './db.js';
import { Player } from './player.js';
import { canRecord, startRecording } from './recorder.js';
import {
  parseMediaUrl, parseTime, formatTime, isAudioFile, guessMime, isWhatsAppFile, friendlyName, extractFirstUrl,
} from './sources.js';

const COLORS = ['#ff5d73', '#ff9f1c', '#ffd23f', '#3ddc97', '#2ec4b6', '#4cc9f0', '#4361ee', '#9b5de5', '#f15bb5', '#8d99ae'];
const EMOJIS = ['🔊', '😂', '👏', '🥁', '📯', '💥', '🎺', '😱', '🐐', '🤡', '💬', '🎵', '🔥', '💀', '🙌', '❌'];
const BADGES = { youtube: 'YouTube', spotify: 'Spotify', url: 'Link' };

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const els = {
  board: $('#board'),
  empty: $('#empty'),
  dialog: $('#sound-dialog'),
  help: $('#help-dialog'),
  details: $('#details-form'),
  linkForm: $('#link-form'),
  linkInput: $('#link-input'),
  fileInput: $('#file-input'),
  importInput: $('#import-input'),
  menu: $('#menu'),
  menuBtn: $('#menu-btn'),
  editToggle: $('#edit-toggle'),
  editBanner: $('#edit-banner'),
  previewPad: $('#preview-pad'),
  toast: $('#toast'),
  dropOverlay: $('#drop-overlay'),
};

const state = {
  sounds: [],
  editMode: false,
  draft: null, // sonido que se está creando o editando
  isNew: false,
  nameTouched: false,
  recording: null,
  installPrompt: null,
};

const settings = {
  get overlap() {
    try { return localStorage.getItem('botonera.overlap') !== '0'; } catch { return true; }
  },
  set overlap(v) {
    try { localStorage.setItem('botonera.overlap', v ? '1' : '0'); } catch { /* modo privado */ }
  },
};

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

// ---------- Reproductor ----------

const player = new Player({
  dock: $('#dock'),
  onChange(id, playing, progress) {
    for (const pad of $$(`.pad[data-id="${CSS.escape(id)}"]`)) {
      pad.classList.toggle('playing', playing);
      pad.style.setProperty('--progress', playing && progress ? String(progress) : '0');
    }
  },
  onError: (msg) => toast(msg),
});
player.overlap = settings.overlap;

// ---------- Render ----------

function padContent(pad, sound) {
  pad.style.setProperty('--pad', sound.color || COLORS[0]);
  pad.dataset.id = sound.id;
  pad.replaceChildren();
  const emoji = document.createElement('span');
  emoji.className = 'pad-emoji';
  emoji.textContent = sound.emoji || '🔊';
  const name = document.createElement('span');
  name.className = 'pad-name';
  name.textContent = sound.name || 'Sin nombre';
  const progress = document.createElement('span');
  progress.className = 'pad-progress';
  pad.append(emoji, name, progress);
  if (BADGES[sound.kind]) {
    const badge = document.createElement('span');
    badge.className = `pad-badge ${sound.kind}`;
    badge.textContent = BADGES[sound.kind];
    pad.append(badge);
  }
}

function render() {
  els.board.replaceChildren(...state.sounds.map((sound, i) => {
    const pad = document.createElement('button');
    pad.className = 'pad';
    pad.type = 'button';
    padContent(pad, sound);
    if (player.isPlaying(sound.id)) pad.classList.add('playing');
    if (i < 10) pad.dataset.key = String((i + 1) % 10);
    pad.draggable = state.editMode;
    return pad;
  }));
  els.empty.hidden = state.sounds.length > 0;
  document.body.classList.toggle('editing', state.editMode);
}

function setEditMode(on) {
  state.editMode = on;
  els.editToggle.setAttribute('aria-pressed', String(on));
  els.editBanner.hidden = !on;
  render();
}

// ---------- Toast ----------

let toastTimer;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3800);
}

// ---------- Diálogo de agregar / editar ----------

function showStep(step) {
  for (const s of $$('.step', els.dialog)) s.hidden = s.dataset.step !== step;
}

function openAdd() {
  closeMenu();
  state.draft = null;
  els.linkInput.value = '';
  showStep('source');
  if (!els.dialog.open) els.dialog.showModal();
}

function closeSoundDialog() {
  if (els.dialog.open) els.dialog.close();
}

els.dialog.addEventListener('close', () => {
  state.recording?.cancel();
  state.recording = null;
  resetRecorderUI();
  if (state.draft) player.stop(state.draft.id);
  state.draft = null;
});

function nextColor() {
  return COLORS[state.sounds.length % COLORS.length];
}

function baseDraft(extra) {
  return { id: uid(), color: nextColor(), emoji: '🔊', start: null, end: null, volume: 1, loop: false, createdAt: Date.now(), ...extra };
}

function draftFromFile(file) {
  const whatsapp = isWhatsAppFile(file.name);
  return baseDraft({
    kind: 'file',
    name: friendlyName(file.name),
    emoji: whatsapp ? '💬' : '🔊',
    fileName: file.name || 'audio',
    blob: new Blob([file], { type: guessMime(file) }),
  });
}

function draftFromLink(parsed) {
  if (parsed.kind === 'youtube') {
    return baseDraft({ kind: 'youtube', name: 'Video de YouTube', emoji: '▶️', videoId: parsed.videoId, start: parsed.start });
  }
  if (parsed.kind === 'spotify') {
    return baseDraft({ kind: 'spotify', name: 'Spotify', emoji: '🎵', uri: parsed.uri, spotifyType: parsed.type });
  }
  const last = decodeURIComponent(new URL(parsed.url).pathname.split('/').pop() || '');
  return baseDraft({ kind: 'url', name: friendlyName(last) === 'Sonido nuevo' ? 'Sonido del link' : friendlyName(last), url: parsed.url });
}

/** Busca el título real del video / tema para proponerlo como nombre. */
async function fetchTitle(draft) {
  const target = draft.kind === 'youtube'
    ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${draft.videoId}`)}`
    : draft.kind === 'spotify'
      ? `https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/${draft.spotifyType}/${draft.uri.split(':').pop()}`)}`
      : null;
  if (!target) return;
  try {
    const res = await fetch(target);
    if (!res.ok) return;
    const { title } = await res.json();
    if (!title || state.draft !== draft || state.nameTouched) return;
    const short = title.length > 40 ? `${title.slice(0, 39)}…` : title;
    draft.name = short;
    els.details.elements.name.value = short;
    updatePreview();
  } catch { /* sin conexión o CORS: queda el nombre genérico */ }
}

function sourceLine(draft) {
  switch (draft.kind) {
    case 'youtube': return `▶️ YouTube · ${draft.videoId}. Se reproduce con el reproductor de YouTube (necesita internet).`;
    case 'spotify': return '🎵 Spotify. Se reproduce con el reproductor de Spotify (necesita internet; sin sesión iniciada suena una vista previa).';
    case 'url': return `🔗 ${draft.url}`;
    default: return `📁 ${draft.fileName || 'Audio guardado en este dispositivo'}`;
  }
}

function openDetails(draft, isNew) {
  closeMenu();
  if (els.help.open) els.help.close();
  state.draft = draft;
  state.isNew = isNew;
  state.nameTouched = !isNew;
  const f = els.details.elements;
  f.name.value = draft.name || '';
  f.emoji.value = draft.emoji || '';
  f.start.value = draft.start ? formatTime(draft.start) : '';
  f.end.value = draft.end ? formatTime(draft.end) : '';
  f.volume.value = draft.volume ?? 1;
  f.loop.checked = !!draft.loop;
  $('#details-title').textContent = isNew ? 'Nuevo sonido' : 'Editar sonido';
  $('#source-line').textContent = sourceLine(draft);
  $('[data-back]', els.details).hidden = !isNew;
  $('.edit-only', els.details).hidden = isNew;
  $('.advanced', els.details).open = !!(draft.start || draft.end || draft.loop || (draft.volume ?? 1) < 1);
  renderSwatches();
  updatePreview();
  updateDurationHint();
  showStep('details');
  if (!els.dialog.open) els.dialog.showModal();
  if (isNew) fetchTitle(draft);
}

function readForm() {
  const f = els.details.elements;
  const d = state.draft;
  d.name = f.name.value.trim() || 'Sin nombre';
  d.emoji = f.emoji.value.trim();
  d.start = parseTime(f.start.value);
  d.end = parseTime(f.end.value);
  if (d.end !== null && d.start !== null && d.end <= d.start) d.end = null;
  d.volume = Number(f.volume.value);
  d.loop = f.loop.checked;
}

function updatePreview() {
  if (!state.draft) return;
  readForm();
  padContent(els.previewPad, state.draft);
  els.previewPad.classList.toggle('playing', player.isPlaying(state.draft.id));
}

function renderSwatches() {
  const box = $('#swatches');
  box.replaceChildren(...COLORS.map((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.background = c;
    b.setAttribute('aria-label', `Color ${c}`);
    b.setAttribute('aria-pressed', String(state.draft?.color === c));
    b.addEventListener('click', () => {
      state.draft.color = c;
      renderSwatches();
      updatePreview();
    });
    return b;
  }));
}

function updateDurationHint() {
  const hint = $('#duration-hint');
  hint.textContent = '';
  const d = state.draft;
  if (!d?.blob) return;
  const url = URL.createObjectURL(d.blob);
  const a = new Audio();
  a.preload = 'metadata';
  a.onloadedmetadata = () => {
    if (Number.isFinite(a.duration) && state.draft === d) hint.textContent = `Duración: ${formatTime(Math.round(a.duration * 10) / 10)}`;
    URL.revokeObjectURL(url);
  };
  a.onerror = () => {
    if (state.draft === d) hint.textContent = '⚠️ Este navegador no reconoce el formato; puede que no suene acá.';
    URL.revokeObjectURL(url);
  };
  a.src = url;
}

/** Intenta bajar un link directo para que funcione sin internet. Si el sitio no lo permite, queda como link. */
async function tryDownload(draft) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(draft.url, { signal: ctrl.signal });
    clearTimeout(timer);
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !(type.startsWith('audio/') || type.startsWith('video/'))) return;
    const blob = await res.blob();
    if (blob.size > 50 * 1024 * 1024) return;
    draft.blob = blob;
    draft.fileName = draft.url;
    draft.kind = 'file';
  } catch { /* CORS o sin conexión */ }
}

async function saveDraft() {
  readForm();
  const draft = state.draft;
  player.stop(draft.id);
  if (draft.kind === 'url' && state.isNew) await tryDownload(draft);
  if (state.isNew) {
    draft.order = state.sounds.length ? Math.max(...state.sounds.map((s) => s.order)) + 1 : 0;
    state.sounds.push(draft);
  } else {
    const i = state.sounds.findIndex((s) => s.id === draft.id);
    draft.order = state.sounds[i].order; // pudo cambiar con "Mover" mientras se editaba
    state.sounds[i] = draft;
  }
  try {
    await putSounds([draft]);
  } catch (e) {
    toast('No se pudo guardar (¿falta espacio en el dispositivo?)');
    console.error(e);
    return;
  }
  navigator.storage?.persist?.().catch(() => {});
  const isNew = state.isNew;
  state.draft = null;
  closeSoundDialog();
  render();
  toast(isNew ? `“${draft.name}” agregado` : 'Cambios guardados');
}

async function addFilesDirectly(files) {
  const drafts = files.map(draftFromFile);
  let order = state.sounds.length ? Math.max(...state.sounds.map((s) => s.order)) + 1 : 0;
  drafts.forEach((d, i) => {
    d.order = order++;
    d.color = COLORS[(state.sounds.length + i) % COLORS.length];
  });
  await putSounds(drafts);
  state.sounds.push(...drafts);
  navigator.storage?.persist?.().catch(() => {});
  render();
  toast(`Se agregaron ${drafts.length} sonidos. Activá ✏️ para cambiarles nombre o emoji.`);
}

/** Punto de entrada común para archivos y links: input, arrastrar, pegar o "Compartir". */
async function handleIncoming({ files = [], text = '' }) {
  const audio = files.filter(isAudioFile);
  if (audio.length === 1) return openDetails(draftFromFile(audio[0]), true);
  if (audio.length > 1) {
    closeSoundDialog();
    return addFilesDirectly(audio);
  }
  if (files.length) return toast('Ese archivo no parece ser un audio.');
  const parsed = text ? parseMediaUrl(text) : null;
  if (parsed) return openDetails(draftFromLink(parsed), true);
  if (text) toast('No encontré un link de audio, YouTube o Spotify.');
}

// ---------- Grabación ----------

let recTimer;
function resetRecorderUI() {
  clearInterval(recTimer);
  const btn = $('#rec-btn');
  btn.classList.remove('recording');
  btn.setAttribute('aria-label', 'Empezar a grabar');
  $('#rec-time').textContent = '0:00';
  $('#rec-hint').textContent = 'Tocá el círculo para empezar.';
}

async function toggleRecording() {
  const btn = $('#rec-btn');
  if (state.recording) {
    const rec = state.recording;
    state.recording = null;
    clearInterval(recTimer);
    const blob = await rec.stop();
    resetRecorderUI();
    const draft = baseDraft({ kind: 'file', name: `Grabación ${new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`, emoji: '🎙️', blob, fileName: 'Grabación' });
    openDetails(draft, true);
    return;
  }
  try {
    state.recording = await startRecording();
  } catch (e) {
    toast(e.name === 'NotAllowedError' ? 'Necesito permiso para usar el micrófono.' : 'No se pudo acceder al micrófono.');
    return;
  }
  btn.classList.add('recording');
  btn.setAttribute('aria-label', 'Terminar grabación');
  $('#rec-hint').textContent = 'Grabando… tocá de nuevo para terminar.';
  const t0 = Date.now();
  recTimer = setInterval(() => { $('#rec-time').textContent = formatTime(Math.floor((Date.now() - t0) / 1000)); }, 250);
}

// ---------- Exportar / importar ----------

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function exportBoard() {
  closeMenu();
  if (!state.sounds.length) return toast('La botonera está vacía.');
  const sounds = await Promise.all(state.sounds.map(async (s) => ({ ...s, blob: s.blob ? await blobToDataUrl(s.blob) : undefined })));
  const file = new Blob([JSON.stringify({ app: 'botonera', version: 1, exportedAt: new Date().toISOString(), sounds })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = `botonera-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function importBoard(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'botonera' || !Array.isArray(data.sounds)) throw new Error('formato');
    let order = state.sounds.length ? Math.max(...state.sounds.map((s) => s.order)) + 1 : 0;
    const sounds = await Promise.all(data.sounds.map(async (s) => ({
      ...s,
      id: uid(),
      order: order++,
      blob: s.blob ? await (await fetch(s.blob)).blob() : undefined,
    })));
    await putSounds(sounds);
    state.sounds.push(...sounds);
    render();
    toast(`Se importaron ${sounds.length} sonidos.`);
  } catch (e) {
    console.error(e);
    toast('Ese archivo no es una botonera válida.');
  }
}

// ---------- Orden ----------

async function moveSound(id, toIndex) {
  const from = state.sounds.findIndex((s) => s.id === id);
  if (from < 0) return;
  const to = Math.max(0, Math.min(state.sounds.length - 1, toIndex));
  if (from === to) return;
  const [s] = state.sounds.splice(from, 1);
  state.sounds.splice(to, 0, s);
  state.sounds.forEach((x, i) => { x.order = i; });
  await putSounds(state.sounds);
  render();
}

// ---------- Menú ----------

function closeMenu() {
  els.menu.hidden = true;
  els.menuBtn.setAttribute('aria-expanded', 'false');
}

function openWhatsAppHelp() {
  closeMenu();
  closeSoundDialog();
  els.help.showModal();
}

// ---------- Eventos ----------

function bindEvents() {
  document.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'add') openAdd();
    if (action === 'whatsapp-help') openWhatsAppHelp();
    if (action === 'export') exportBoard();
    if (action === 'import') { closeMenu(); els.importInput.click(); }
    if (action === 'install') {
      closeMenu();
      state.installPrompt?.prompt();
      state.installPrompt = null;
      $('[data-action="install"]').hidden = true;
    }
    if (!e.target.closest('#menu, #menu-btn')) closeMenu();
  });

  els.menuBtn.addEventListener('click', () => {
    els.menu.hidden = !els.menu.hidden;
    els.menuBtn.setAttribute('aria-expanded', String(!els.menu.hidden));
  });

  $('#opt-overlap').checked = settings.overlap;
  $('#opt-overlap').addEventListener('change', (e) => {
    settings.overlap = e.target.checked;
    player.overlap = e.target.checked;
  });

  $('#stop-all').addEventListener('click', () => player.stopAll());
  els.editToggle.addEventListener('click', () => setEditMode(!state.editMode));
  $('#edit-done').addEventListener('click', () => setEditMode(false));

  // Pads: tocar = sonar; en modo edición o con toque largo = editar.
  let pressTimer;
  let longPressed = false;
  els.board.addEventListener('pointerdown', (e) => {
    const pad = e.target.closest('.pad');
    if (!pad || state.editMode) return;
    longPressed = false;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      longPressed = true;
      navigator.vibrate?.(20);
      const sound = state.sounds.find((s) => s.id === pad.dataset.id);
      if (sound) openDetails({ ...sound }, false);
    }, 600);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) els.board.addEventListener(ev, () => clearTimeout(pressTimer));
  els.board.addEventListener('contextmenu', (e) => { if (e.target.closest('.pad')) e.preventDefault(); });
  els.board.addEventListener('click', (e) => {
    const pad = e.target.closest('.pad');
    if (!pad) return;
    if (longPressed) { longPressed = false; return; }
    const sound = state.sounds.find((s) => s.id === pad.dataset.id);
    if (!sound) return;
    if (state.editMode) openDetails({ ...sound }, false);
    else player.toggle(sound);
  });

  // Ordenar arrastrando (modo edición, escritorio)
  els.board.addEventListener('dragstart', (e) => {
    const pad = e.target.closest('.pad');
    if (!pad || !state.editMode) return;
    e.dataTransfer.setData('text/x-botonera-id', pad.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    pad.classList.add('dragging');
  });
  els.board.addEventListener('dragend', (e) => e.target.closest('.pad')?.classList.remove('dragging'));
  els.board.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('text/x-botonera-id')) e.preventDefault();
  });
  els.board.addEventListener('drop', (e) => {
    const id = e.dataTransfer.getData('text/x-botonera-id');
    const target = e.target.closest('.pad');
    if (!id || !target) return;
    e.preventDefault();
    e.stopPropagation();
    moveSound(id, state.sounds.findIndex((s) => s.id === target.dataset.id));
  });

  // Diálogo
  for (const d of [els.dialog, els.help]) {
    d.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]') || e.target === d) d.close();
    });
  }
  for (const b of $$('[data-back]', els.dialog)) {
    b.addEventListener('click', () => {
      state.recording?.cancel();
      state.recording = null;
      resetRecorderUI();
      if (state.draft) player.stop(state.draft.id);
      state.draft = null;
      showStep('source');
    });
  }
  $('[data-source="file"]').addEventListener('click', () => els.fileInput.click());
  $('[data-source="record"]').addEventListener('click', () => {
    if (!canRecord()) return toast('Este navegador no permite grabar audio.');
    showStep('record');
  });
  $('#rec-btn').addEventListener('click', toggleRecording);

  els.fileInput.addEventListener('change', () => {
    const files = [...els.fileInput.files];
    els.fileInput.value = '';
    handleIncoming({ files });
  });
  els.importInput.addEventListener('change', () => {
    const [file] = els.importInput.files;
    els.importInput.value = '';
    if (file) importBoard(file);
  });

  $('#paste-btn').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      els.linkInput.value = extractFirstUrl(text) || text;
      if (parseMediaUrl(els.linkInput.value)) els.linkForm.requestSubmit();
    } catch {
      els.linkInput.focus();
      toast('Mantené apretado el campo y elegí “Pegar”.');
    }
  });
  els.linkForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const parsed = parseMediaUrl(els.linkInput.value);
    if (!parsed) return toast('Ese link no lo reconozco. Probá con uno de YouTube, Spotify o un .mp3');
    openDetails(draftFromLink(parsed), true);
  });

  // Formulario de detalles
  els.details.addEventListener('input', (e) => {
    if (e.target.name === 'name') state.nameTouched = true;
    updatePreview();
  });
  $('#emoji-picks').replaceChildren(...EMOJIS.map((em) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = em;
    b.addEventListener('click', () => {
      els.details.elements.emoji.value = em;
      updatePreview();
    });
    return b;
  }));
  els.previewPad.addEventListener('click', () => {
    if (!state.draft) return;
    readForm();
    player.toggle(state.draft);
    els.previewPad.classList.toggle('playing', player.isPlaying(state.draft.id));
  });
  els.details.addEventListener('submit', (e) => {
    e.preventDefault();
    saveDraft();
  });
  $('#delete-btn').addEventListener('click', async () => {
    const d = state.draft;
    if (!d || !confirm(`¿Borrar “${d.name}”?`)) return;
    player.stop(d.id);
    await deleteSound(d.id);
    state.sounds = state.sounds.filter((s) => s.id !== d.id);
    state.draft = null;
    closeSoundDialog();
    render();
    toast('Sonido borrado');
  });
  for (const b of $$('[data-move]', els.details)) {
    b.addEventListener('click', async () => {
      const d = state.draft;
      const i = state.sounds.findIndex((s) => s.id === d.id);
      await moveSound(d.id, i + Number(b.dataset.move));
    });
  }

  // Arrastrar archivos a la ventana
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer?.types?.includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    dragDepth++;
    els.dropOverlay.hidden = false;
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) els.dropOverlay.hidden = true;
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    els.dropOverlay.hidden = true;
    handleIncoming({ files: [...e.dataTransfer.files] });
  });

  // Pegar (Ctrl+V) un audio o un link en cualquier lado
  document.addEventListener('paste', (e) => {
    if (e.target.closest?.('input, textarea')) return;
    const files = [...(e.clipboardData?.files || [])];
    const text = e.clipboardData?.getData('text') || '';
    if (files.length || text) {
      e.preventDefault();
      handleIncoming({ files, text });
    }
  });

  // Teclado: 1..9, 0 disparan los primeros sonidos; Esc para todo.
  document.addEventListener('keydown', (e) => {
    if (els.dialog.open || els.help.open || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea')) return;
    if (e.key === 'Escape') return player.stopAll();
    if (/^[0-9]$/.test(e.key)) {
      const sound = state.sounds[(Number(e.key) + 9) % 10];
      if (sound) player.toggle(sound);
    }
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installPrompt = e;
    $('[data-action="install"]').hidden = false;
  });
}

// ---------- Inicio ----------

async function checkInbox() {
  try {
    const items = await takeInbox();
    if (!items.length) return;
    const files = items.flatMap((it) => (it.files || []).map((f) => new File([f.blob], f.name || 'audio', { type: f.type || f.blob.type })));
    const text = items.map((it) => it.text).filter(Boolean).join(' ');
    await handleIncoming({ files, text });
  } catch (e) {
    console.error(e);
  }
}

async function init() {
  bindEvents();
  try {
    state.sounds = await getAllSounds();
  } catch (e) {
    console.error(e);
    toast('No se pudo abrir el almacenamiento del navegador.');
  }
  render();

  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('sw.js');
    } catch (e) {
      console.warn('Service worker no registrado', e);
    }
  }

  await checkInbox();
  const params = new URLSearchParams(location.search);
  if (params.has('shared')) history.replaceState(null, '', location.pathname);
  // Compartir de texto por GET (fallback de algunos navegadores)
  const sharedText = [params.get('title'), params.get('text'), params.get('url')].filter(Boolean).join(' ');
  if (sharedText) {
    history.replaceState(null, '', location.pathname);
    handleIncoming({ text: sharedText });
  }
  if (params.get('add') === '1') openAdd();
}

init();
