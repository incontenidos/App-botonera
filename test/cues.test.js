import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTINUE, dbToGain, clampDb, formatDb, goFrom, followAfter, effectiveDuration, clock,
} from '../src/cues.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-3, `${a} ≈ ${b}`);

test('dbToGain', () => {
  near(dbToGain(0), 1);
  near(dbToGain(-6), 0.501);
  near(dbToGain(6), 1.995);
  near(dbToGain(-12), 0.251);
  assert.equal(dbToGain(-60), 0);
  assert.equal(dbToGain(-80), 0);
  near(dbToGain(40), dbToGain(12)); // tope de seguridad
});

test('clampDb y formatDb', () => {
  assert.equal(clampDb(3.3), 3.5);
  assert.equal(clampDb(-100), -60);
  assert.equal(clampDb(99), 12);
  assert.equal(formatDb(0), '0 dB');
  assert.equal(formatDb(3), '+3 dB');
  assert.equal(formatDb(-12.5), '-12,5 dB');
  assert.equal(formatDb(-60), '-∞ dB');
});

const list = (...modes) => modes.map((m, i) => ({ id: String(i), continue: m }));

test('goFrom dispara un cue y deja el siguiente en espera', () => {
  const cues = list(CONTINUE.WAIT, CONTINUE.WAIT, CONTINUE.WAIT);
  assert.deepEqual(goFrom(cues, 0), { fire: [0], next: 1 });
  assert.deepEqual(goFrom(cues, 2), { fire: [2], next: 3 });
});

test('goFrom encadena los cues en AUTO', () => {
  const cues = list(CONTINUE.AUTO, CONTINUE.AUTO, CONTINUE.WAIT, CONTINUE.WAIT);
  assert.deepEqual(goFrom(cues, 0), { fire: [0, 1, 2], next: 3 });
  // AUTO en el último no se va de rango
  assert.deepEqual(goFrom(list(CONTINUE.WAIT, CONTINUE.AUTO), 1), { fire: [1], next: 2 });
});

test('goFrom fuera de rango no dispara nada', () => {
  assert.deepEqual(goFrom(list(CONTINUE.WAIT), 1), { fire: [], next: 1 });
});

test('followAfter', () => {
  const cues = list(CONTINUE.FOLLOW, CONTINUE.WAIT, CONTINUE.FOLLOW);
  assert.equal(followAfter(cues, 0), 1);
  assert.equal(followAfter(cues, 1), null);
  assert.equal(followAfter(cues, 2), null); // último
});

test('effectiveDuration respeta el recorte', () => {
  assert.equal(effectiveDuration({ duration: 100 }), 100);
  assert.equal(effectiveDuration({ duration: 100, start: 10, end: 40 }), 30);
  assert.equal(effectiveDuration({ duration: 100, start: 90, end: 200 }), 10);
  assert.equal(effectiveDuration({ duration: undefined }), null);
  assert.equal(effectiveDuration({ kind: 'stop', fade: 3 }), 3);
});

test('clock', () => {
  assert.equal(clock(7), '00:07.0');
  assert.equal(clock(2.6), '00:02.6');
  assert.equal(clock(902.5), '15:02');
  assert.equal(clock(null), '--:--');
});
