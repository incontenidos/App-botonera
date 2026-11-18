"""Genera el audio original del video (música, tic-tac y campanada) por síntesis.

Todo se crea con código, sin grabaciones de terceros: no hay derechos que pagar.
Uso: python3 tools/make_audio.py assets/audio
"""
import sys
import wave
from pathlib import Path

import numpy as np

SR = 44100
BPM = 132
BEAT = 60 / BPM
LENGTH = 15.4


def write_wav(path, x):
    x = np.clip(x, -1, 1)
    data = (x * 32767).astype(np.int16)
    if data.ndim == 1:
        data = np.stack([data, data], axis=1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


def env(n, attack=0.004, decay=0.25):
    t = np.arange(n) / SR
    a = np.minimum(1, t / attack)
    return a * np.exp(-t / decay)


def midi(m):
    return 440 * 2 ** ((m - 69) / 12)


def pluck(freq, dur, decay=0.18, bright=3):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = sum(np.sin(2 * np.pi * freq * k * t) / k ** 1.4 for k in range(1, bright + 1))
    return s * env(n, 0.003, decay)


def add(buf, sig, at, gain=1.0):
    i = int(at * SR)
    j = min(len(buf), i + len(sig))
    if j > i:
        buf[i:j] += sig[: j - i] * gain


def noise_hit(dur, decay, hp=True, seed=0):
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    x = rng.standard_normal(n)
    if hp:
        x = np.diff(x, prepend=0)
    return x * env(n, 0.001, decay)


def kick():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = 50 + 90 * np.exp(-t / 0.04)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * env(n, 0.002, 0.12)


def music():
    buf = np.zeros(int(LENGTH * SR) + SR)
    # Progresión alegre tipo vodevil: C - A7 - Dm7 - G7 (una por compás)
    prog = [(48, [60, 64, 67]), (45, [61, 64, 67]), (50, [60, 65, 69]), (43, [59, 62, 65, 67])]
    melody = [72, 76, 79, 76, 81, 79, 76, 74,
              73, 76, 79, 81, 79, 76, 73, 76,
              74, 77, 81, 77, 84, 81, 77, 74,
              79, 77, 74, 71, 74, 77, 79, 83]
    bars = int(LENGTH / (4 * BEAT)) + 1
    for bar in range(bars):
        root, chord = prog[bar % 4]
        t0 = bar * 4 * BEAT
        for b in range(4):
            tb = t0 + b * BEAT
            # Oom-pah: bajo en 1 y 3 (raíz y quinta), acorde en 2 y 4
            if b in (0, 2):
                note = root if b == 0 else root + 7
                add(buf, pluck(midi(note - 12), 0.4, 0.22, 2), tb, 0.55)
                add(buf, kick(), tb, 0.5)
            else:
                for m in chord:
                    add(buf, pluck(midi(m), 0.3, 0.12, 4), tb, 0.12)
                add(buf, noise_hit(0.2, 0.06, seed=bar * 4 + b), tb, 0.10)
            # Hi-hat en corcheas
            add(buf, noise_hit(0.05, 0.012, seed=1000 + bar * 8 + b), tb, 0.05)
            add(buf, noise_hit(0.05, 0.012, seed=2000 + bar * 8 + b), tb + BEAT / 2, 0.035)
        # Melodía en corcheas, desde el compás 2 para dejar respirar el gancho
        if bar >= 1:
            phrase = melody[(bar % 4) * 8:(bar % 4) * 8 + 8]
            for k, m in enumerate(phrase):
                add(buf, pluck(midi(m), 0.25, 0.1, 5), t0 + k * BEAT / 2, 0.16)
    buf = buf[: int(LENGTH * SR)]
    # Fundido de salida en el último segundo
    fade = np.ones(len(buf))
    nf = int(1.0 * SR)
    fade[-nf:] = np.linspace(1, 0, nf)
    buf *= fade
    return buf / np.max(np.abs(buf)) * 0.6


def tick(high=True):
    # Tac de bloque de madera: dos modos resonantes breves
    n = int(0.08 * SR)
    t = np.arange(n) / SR
    f = 2600 if high else 1900
    s = np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * f * 2.7 * t)
    s = s * env(n, 0.0005, 0.012) + noise_hit(0.08, 0.004, seed=7 if high else 8) * 0.3
    return s / np.max(np.abs(s)) * 0.8


def ticktock():
    # Tic-tac que se acelera durante 2.6 s (el reloj corre rápido)
    buf = np.zeros(int(2.8 * SR))
    t, gap, k = 0.0, 0.32, 0
    while t < 2.6:
        add(buf, tick(k % 2 == 0), t)
        t += gap
        gap = max(0.07, gap * 0.86)
        k += 1
    return buf


def bell():
    # Campana: parciales inarmónicos de campana de iglesia, decaimiento largo
    dur = 3.5
    n = int(dur * SR)
    t = np.arange(n) / SR
    f0 = 330
    partials = [(0.5, 1.0, 1.6), (1.0, 0.8, 1.2), (1.19, 0.6, 1.0), (1.5, 0.45, 0.8),
                (2.0, 0.5, 0.7), (2.5, 0.3, 0.5), (3.0, 0.25, 0.4), (4.07, 0.15, 0.25)]
    s = sum(a * np.sin(2 * np.pi * f0 * r * t) * np.exp(-t / d) for r, a, d in partials)
    s += noise_hit(dur, 0.01, seed=9) * 0.2
    s *= np.minimum(1, t / 0.002)
    return s / np.max(np.abs(s)) * 0.85


if __name__ == "__main__":
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    write_wav(out / "musica.wav", music())
    write_wav(out / "tictac.wav", ticktock())
    write_wav(out / "campana.wav", bell())
    print("ok", sorted(p.name for p in out.iterdir()))
