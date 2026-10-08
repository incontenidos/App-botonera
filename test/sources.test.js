import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractFirstUrl, parseTime, formatTime, parseMediaUrl, isAudioFile, guessMime, isWhatsAppFile, friendlyName,
} from '../src/sources.js';

test('extractFirstUrl encuentra el link dentro del texto compartido', () => {
  assert.equal(extractFirstUrl('Mirá esto https://youtu.be/dQw4w9WgXcQ?si=abc jaja'), 'https://youtu.be/dQw4w9WgXcQ?si=abc');
  assert.equal(extractFirstUrl('(https://open.spotify.com/track/abc).'), 'https://open.spotify.com/track/abc');
  assert.equal(extractFirstUrl('sin links'), null);
  assert.equal(extractFirstUrl(''), null);
});

test('parseTime acepta segundos, mm:ss y formato de YouTube', () => {
  assert.equal(parseTime('83'), 83);
  assert.equal(parseTime('1:23'), 83);
  assert.equal(parseTime('01:02:03'), 3723);
  assert.equal(parseTime('1m23s'), 83);
  assert.equal(parseTime('90s'), 90);
  assert.equal(parseTime('1,5'), 1.5);
  assert.equal(parseTime(''), null);
  assert.equal(parseTime('hola'), null);
  assert.equal(parseTime(null), null);
});

test('formatTime', () => {
  assert.equal(formatTime(5), '0:05');
  assert.equal(formatTime(83), '1:23');
  assert.equal(formatTime(3723), '1:02:03');
  assert.equal(formatTime(1.5), '0:01.5');
  assert.equal(formatTime(null), '');
});

test('parseMediaUrl reconoce YouTube en todas sus variantes', () => {
  const id = 'dQw4w9WgXcQ';
  for (const u of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://m.youtube.com/watch?v=${id}&feature=share`,
    `https://youtu.be/${id}`,
    `https://youtube.com/shorts/${id}?si=xyz`,
    `https://music.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/embed/${id}`,
  ]) {
    assert.deepEqual(parseMediaUrl(u), { kind: 'youtube', videoId: id, start: null }, u);
  }
  assert.equal(parseMediaUrl(`https://youtu.be/${id}?t=42`).start, 42);
  assert.equal(parseMediaUrl(`https://www.youtube.com/watch?v=${id}&t=1m5s`).start, 65);
  assert.equal(parseMediaUrl('https://www.youtube.com/watch?v=corto'), null);
  assert.equal(parseMediaUrl('https://www.youtube.com/'), null);
});

test('parseMediaUrl reconoce Spotify', () => {
  assert.deepEqual(parseMediaUrl('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=123'), {
    kind: 'spotify', type: 'track', id: '4cOdK2wGLETKBW3PvgPWqT', uri: 'spotify:track:4cOdK2wGLETKBW3PvgPWqT',
  });
  assert.equal(parseMediaUrl('https://open.spotify.com/intl-es/episode/abc123').uri, 'spotify:episode:abc123');
  assert.equal(parseMediaUrl('spotify:track:abc123').uri, 'spotify:track:abc123');
  assert.equal(parseMediaUrl('Escuchá "Tema" en Spotify https://open.spotify.com/track/xyz').id, 'xyz');
  assert.equal(parseMediaUrl('https://open.spotify.com/user/pepe'), null);
});

test('parseMediaUrl deja pasar links directos y rechaza basura', () => {
  assert.deepEqual(parseMediaUrl('https://ejemplo.com/risas.mp3'), { kind: 'url', url: 'https://ejemplo.com/risas.mp3' });
  assert.equal(parseMediaUrl('no es un link'), null);
  assert.equal(parseMediaUrl(''), null);
  assert.equal(parseMediaUrl('ftp://x.com/a.mp3'), null);
});

test('isAudioFile y guessMime contemplan las notas de voz de WhatsApp', () => {
  assert.ok(isAudioFile({ name: 'PTT-20240105-WA0007.opus', type: '' }));
  assert.ok(isAudioFile({ name: 'x', type: 'audio/ogg; codecs=opus' }));
  assert.ok(isAudioFile({ name: 'video.mp4', type: 'video/mp4' }));
  assert.ok(!isAudioFile({ name: 'foto.jpg', type: 'image/jpeg' }));
  assert.equal(guessMime({ name: 'PTT-20240105-WA0007.opus', type: '' }), 'audio/ogg');
  assert.equal(guessMime({ name: 'a.m4a', type: 'application/octet-stream' }), 'audio/mp4');
  assert.equal(guessMime({ name: 'a.wav', type: 'audio/x-wav' }), 'audio/x-wav');
});

test('friendlyName', () => {
  assert.ok(isWhatsAppFile('PTT-20240105-WA0007.opus'));
  assert.ok(isWhatsAppFile('WhatsApp Audio 2024-01-05 at 10.22.33.ogg'));
  assert.ok(!isWhatsAppFile('risa.mp3'));
  assert.equal(friendlyName('PTT-20240105-WA0007.opus'), 'Audio WhatsApp 05/01');
  assert.equal(friendlyName('WhatsApp Audio 2024-03-09 at 10.22.33.ogg'), 'Audio WhatsApp 09/03');
  assert.equal(friendlyName('aplausos_fuertes.mp3'), 'Aplausos fuertes');
  assert.equal(friendlyName(''), 'Sonido nuevo');
  assert.ok(friendlyName('a'.repeat(50) + '.mp3').length <= 28);
});
