"""Diseño de sonido del reel TEATRALOGÍA: música, efectos y ambiente, sintetizados y alineados al frame.

Todo es original (síntesis por código): no hay grabaciones de terceros.
Uso: python3 -I tools/sound.py   (desde la carpeta del proyecto)
Escribe assets/audio/musica.wav, sfx.wav y ambiente.wav, y tools/cues.json (los tiempos que usan las escenas).
"""
import json
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SR = 44100
TOTAL = 52.0
rng = np.random.default_rng(1647)

# ---- Tabla de tiempos (segundos absolutos) ----
T = {
    "clack1": 0.05, "clack2": 1.55, "hum": (0.0, 8.6),
    "s2": 4.0, "glitch": [7.9, 8.15, 8.38], "negro": (8.6, 9.0),
    "s3": 9.0, "giro": (10.2, 11.1),
    "s4": 12.0, "choque": 12.35, "trazos": [12.72, 12.92, 13.12], "split": 13.6,
    "caen": 15.0, "arena": (15.3, 16.4), "encastre": 15.85,
    "s5": 18.0, "tipeo": (18.1, 0.035, 31), "cuerda": (18.1, 21.4),
    "s6": 21.4, "s7": 27.4, "texto7": 28.7, "sala": (28.6, 41.4),
    "s8": 31.4, "latidos": [33.0, 33.7], "piano": (32.9, 41.4),
    "s9": 35.4, "clave": 35.5, "boop": 38.8,
    "apagon": 41.4, "placa": 42.2, "golpes": [42.8, 44.5, 46.93], "paneos": [43.5, 44.85, 46.13],
    "chopin": (42.2, 46.93), "murmullo": (42.2, 52.0),
}


def notif_times():
    """Notificaciones de la escena 2 (tiempo local): cada vez más rápido hasta saturar."""
    t, gap, out = 1.6, 0.34, []
    while t < 4.5:
        out.append(round(t, 3))
        t += gap
        gap = max(0.028, gap * 0.9)
    return out


def swipe_times():
    """Swipes de la escena 6 (tiempo local), acelerando con el feed."""
    t, gap, out = 1.25, 0.5, []
    while t < 5.95:
        out.append(round(t, 3))
        t += gap
        gap = max(0.09, gap * 0.86)
    return out


# ---- Herramientas de síntesis ----
def n_(d):
    return int(d * SR)


def tt(d):
    return np.arange(n_(d)) / SR


def env(d, a, dec):
    t = tt(d)
    return np.minimum(1, t / max(a, 1e-4)) * np.exp(-t / dec)


def noise(d):
    return rng.standard_normal(n_(d))


def lp(x, cutoff):
    """Pasa-bajos de un polo; cutoff puede ser un array (barrido)."""
    c = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = np.exp(-2 * np.pi * c / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a[i]) * x[i] + a[i] * acc
        y[i] = acc
    return y


def hp(x, cutoff):
    return x - lp(x, cutoff)


def put(buf, sig, at, gain=1.0):
    i = int(round(at * SR))
    j = min(len(buf), i + len(sig))
    if j > i >= 0:
        buf[i:j] += sig[: j - i] * gain


def norm(x, peak=1.0):
    m = np.max(np.abs(x))
    return x / m * peak if m > 0 else x


def reverb(x, secs=2.5, mix=0.5):
    ir_t = tt(secs)
    ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t / (secs / 6.5))
    ir = lp(ir, 3500)
    L = len(x) + len(ir)
    wet = np.fft.irfft(np.fft.rfft(x, L) * np.fft.rfft(ir, L), L)[:L]
    out = np.zeros(L)
    out[: len(x)] += x * (1 - mix)
    out += norm(wet, np.max(np.abs(x))) * mix
    return out


# ---- Efectos ----
def clack():
    # Relé + golpe de carcasa metálica de un reflector teatral
    click = hp(noise(0.03), 2000) * env(0.03, 0.0002, 0.004)
    body = np.sin(2 * np.pi * 180 * tt(0.25)) * env(0.25, 0.001, 0.035)
    thunk = lp(noise(0.25), 600) * env(0.25, 0.001, 0.05)
    s = np.zeros(n_(0.25))
    s[: len(click)] += click * 1.2
    s += body * 0.7 + thunk * 0.9
    return norm(reverb(s, 0.8, 0.25))


def hum(d):
    t = tt(d)
    s = (np.sin(2 * np.pi * 50 * t) + 0.5 * np.sin(2 * np.pi * 100 * t) + 0.25 * np.sin(2 * np.pi * 150 * t)
         + 0.08 * np.sign(np.sin(2 * np.pi * 100 * t)))
    s *= 1 + 0.08 * np.sin(2 * np.pi * 0.7 * t)
    fade = np.minimum(1, t / 0.05)
    return s * fade


def ping(f=1320):
    t = tt(0.32)
    s = np.sin(2 * np.pi * f * t) * env(0.32, 0.002, 0.07) + 0.6 * np.sin(2 * np.pi * f * 1.5 * t) * env(0.32, 0.002, 0.05)
    return s


def glitch(d=0.12):
    x = noise(d)
    steps = rng.integers(6, 30)
    x = np.repeat(x[::steps], steps)[: n_(d)]
    x = np.round(x * 3) / 3
    square = np.sign(np.sin(2 * np.pi * rng.uniform(200, 900) * tt(d)))
    return (x * 0.6 + square * 0.4) * env(d, 0.001, d / 2)


def whoosh(d, f0, f1, dark=False):
    t = tt(d)
    cut = f0 * (f1 / f0) ** (t / d)
    s = lp(noise(d), cut)
    shape = np.sin(np.pi * np.minimum(1, t / d)) ** 1.5
    if dark:
        s += np.sin(2 * np.pi * np.cumsum(40 + 30 * t / d) / SR) * 0.6
    return norm(s * shape)


def kick(f=55, d=0.6):
    t = tt(d)
    f_t = f + 110 * np.exp(-t / 0.025)
    return np.sin(2 * np.pi * np.cumsum(f_t) / SR) * env(d, 0.001, 0.16)


def metal_hit():
    t = tt(2.2)
    ratios = [1, 2.76, 5.40, 8.93, 13.34]
    s = sum(np.sin(2 * np.pi * 310 * r * t) * np.exp(-t / (0.9 / (k + 1))) for k, r in enumerate(ratios))
    s += lp(noise(2.2), 4000) * env(2.2, 0.0005, 0.03) * 3
    s += kick(48, 2.2) * 2
    return norm(reverb(s, 1.4, 0.3))


def marker(d=0.17):
    t = tt(d)
    s = hp(lp(noise(d), 5000), 1200) * (0.7 + 0.3 * np.sin(2 * np.pi * 38 * t))
    return s * np.sin(np.pi * t / d) ** 0.5


def sand(d):
    t = tt(d)
    x = np.zeros(n_(d))
    dens = rng.random(n_(d)) < 0.004 * (1 - t / d)
    x[dens] = rng.standard_normal(dens.sum())
    x = hp(x, 1500)
    return x + hp(noise(d), 3000) * 0.08 * (1 - t / d)


def click_lock():
    s = hp(noise(0.05), 2500) * env(0.05, 0.0002, 0.005)
    s2 = np.sin(2 * np.pi * 900 * tt(0.08)) * env(0.08, 0.0005, 0.012)
    out = np.zeros(n_(0.12))
    out[: len(s)] += s
    out[n_(0.025): n_(0.025) + len(s2)] += s2 * 0.8
    return norm(out)


def tick_type():
    s = hp(noise(0.04), 1800) * env(0.04, 0.0003, 0.006)
    s[:200] += np.sin(2 * np.pi * 2200 * tt(0.04))[:200] * 0.3
    return s


def cello(d, f=55):
    t = tt(d)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5 * t)
    ph = 2 * np.pi * np.cumsum(f * vib) / SR
    saw = sum(np.sin(k * ph) / k for k in range(1, 14))
    s = lp(saw, 900)
    fade = np.minimum(1, t / 0.6) * np.minimum(1, (d - t) / 0.8)
    return norm(s * fade)


def swipe():
    return whoosh(0.16, 900, 5000) * 0.8


def brutal_impact():
    s = kick(40, 1.0) * 1.5 + lp(noise(1.0), 1800) * env(1.0, 0.0005, 0.09) + metal_hit()[: n_(1.0)] * 0.3
    return norm(reverb(s, 3.6, 0.55))


def room(d):
    # Murmullo de sala vacía: aire grave y lejano
    t = tt(d)
    x = lp(noise(d), 420) * 3 + lp(noise(d), 120) * 4
    x *= 1 + 0.15 * np.sin(2 * np.pi * 0.13 * t)
    return norm(x) * np.minimum(1, t / 0.8) * np.minimum(1, (d - t) / 0.3)


def heartbeat():
    lub = kick(46, 0.4) * 1.0
    dub = kick(52, 0.4) * 0.7
    out = np.zeros(n_(0.6))
    put(out, lub, 0)
    put(out, dub, 0.18)
    return norm(lp(out, 400))


def harpsichord(freqs, d=1.8, spread=0.025):
    out = np.zeros(n_(d + 0.2))
    for i, f in enumerate(freqs):
        t = tt(d)
        s = sum(np.sin(2 * np.pi * f * k * t) * (0.9 ** k) * np.exp(-t * (0.9 + 0.35 * k)) for k in range(1, 16))
        s *= np.minimum(1, t / 0.001)
        put(out, s, i * spread)
    return norm(reverb(out, 1.2, 0.25))


def pizz_boop():
    t = tt(0.35)
    f = 392 * (1 + 0.5 * np.minimum(1, t / 0.05))
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(0.35, 0.002, 0.09)
    s += 0.3 * np.sin(2 * np.pi * np.cumsum(f * 2) / SR) * env(0.35, 0.002, 0.05)
    return norm(s)


def wood_knock():
    t = tt(1.4)
    s = np.sin(2 * np.pi * 95 * t) * np.exp(-t / 0.09) + 0.5 * np.sin(2 * np.pi * 240 * t) * np.exp(-t / 0.04)
    s += lp(noise(1.4), 1200) * env(1.4, 0.0005, 0.02) * 1.5
    return norm(reverb(s, 1.8, 0.4))


def crowd(d):
    # Murmullo de público: muchas "voces" de ruido filtrado por banda de habla, moduladas
    t = tt(d)
    x = np.zeros(n_(d))
    for _ in range(14):
        f = rng.uniform(250, 900)
        band = lp(hp(noise(d), f * 0.7), f * 1.6)
        mod = 0.5 + 0.5 * np.sin(2 * np.pi * rng.uniform(2.5, 5.5) * t + rng.uniform(0, 6.28))
        x += band * mod
    x = norm(x)
    shape = np.minimum(1, t / 1.0) * np.clip((d - 0.3 - t) / (d - 2.6), 0, 1) ** 1.3
    return x * shape


# ---- Música ----
def electronica():
    """0 s → fin del scroll: pulso grave y percusión seca que crecen con la aceleración del feed; corte total en la frenada."""
    buf = np.zeros(n_(TOTAL))
    beat = 0.5  # 120 BPM
    end = T["s7"]
    s6 = T["s6"]

    def g_of(t):
        if t < s6:
            return 0.3 + 0.25 * t / s6
        k = (np.exp(0.56 * (t - s6)) - 1) / (np.exp(0.56 * (end - s6)) - 1)
        return 0.55 + 0.45 * k

    t, k = 0.0, 0
    while t < end:
        g = g_of(t)
        put(buf, kick(50, 0.5) * g, t, 0.9)
        if t >= 4.0:
            put(buf, hp(noise(0.05), 6000) * env(0.05, 0.0005, 0.01) * g, t + beat / 2, 0.35)
        if t >= 12.0:
            put(buf, click_lock() * g, t + beat * 0.75, 0.18)
        if t >= 18.0:
            f = [41.2, 41.2, 49.0, 41.2][k % 4]
            note = lp(np.sign(np.sin(2 * np.pi * f * tt(beat / 2))), 300) * env(beat / 2, 0.003, 0.12) * g
            put(buf, note, t, 0.4)
            put(buf, note, t + beat / 2, 0.3)
        if t >= s6:
            # semicorcheas que se suman a medida que el feed acelera
            sub = 4 if t > s6 + 2.5 else 2
            for s16 in range(sub):
                put(buf, hp(noise(0.03), 7000) * env(0.03, 0.0003, 0.006) * g, t + s16 * beat / sub, 0.25)
        t += beat
        k += 1
    r = whoosh(end - s6, 200, 7000) * np.linspace(0, 1, n_(end - s6)) ** 2.5
    put(buf, r, s6, 0.35)
    buf[n_(end):] = 0  # corte seco en la frenada
    return buf


def piano_note(f, d, vel=1.0, staccato=False, bright=1.0):
    t = tt(d)
    B = 0.0004
    s = np.zeros(len(t))
    for k in range(1, 14):
        fk = f * k * np.sqrt(1 + B * k * k)
        if fk > 9000:
            break
        decay = (2.8 if f < 200 else 1.8) / (1 + 0.35 * k)
        s += np.sin(2 * np.pi * fk * t) * np.exp(-t / decay) * (0.75 ** (k - 1)) * (bright ** (k - 1))
    s += lp(noise(d), 2500) * np.exp(-t / 0.008) * 0.15
    s *= np.minimum(1, t / 0.002)
    if staccato:
        s *= np.clip(1 - (t - 0.11) / 0.05, 0, 1)
    return s * vel


def piano_solo():
    """Desde "Te obliga a estar": piano solo, cálido y espacioso (Sol mayor, 66 BPM)."""
    a, b = T["piano"]
    d = b - a
    buf = np.zeros(n_(d + 4))
    beat = 60 / 66
    G, D, B_, A, E, C, Fs = 98.0, 146.8, 246.9, 220.0, 164.8, 130.8, 185.0
    acordes = [(G, [G * 2, D * 2, B_ * 2]), (E, [E * 2, G * 2 * 1.0, B_ * 2]), (C, [C * 2, G * 2, E * 2 * 2]), (D, [D * 2, Fs * 2, A * 2])]
    melodia = [587.3, 493.9, 440.0, 392.0, 440.0, 493.9, 392.0, 370.0]
    t, i = 0.0, 0
    while t < d:
        root, ch = acordes[i % 4]
        put(buf, piano_note(root, 4, 0.55, bright=0.8), t)
        for j, f in enumerate(ch):
            put(buf, piano_note(f, 3, 0.28, bright=0.85), t + beat * (0.5 + j * 0.5))
        put(buf, piano_note(melodia[(2 * i) % 8] * 2, 3, 0.32, bright=0.9), t + beat * 0.02)
        put(buf, piano_note(melodia[(2 * i + 1) % 8] * 2, 3, 0.26, bright=0.9), t + beat * 2)
        t += beat * 4
        i += 1
    wet = reverb(lp(buf, 5200), 3.2, 0.42)
    out = np.zeros(n_(TOTAL))
    put(out, wet, a)
    # Se apaga de golpe con el clack del apagón
    gate(out, b, TOTAL, 0.03)
    return out


def chopin():
    """Marcha fúnebre de Chopin (Sonata n.º 2, 3.er mov., dominio público): 2 compases en si bemol menor,
    staccato y un poco apurados (≈101 BPM), con un acorde seco final en el último golpe de teatro."""
    a, b = T["chopin"]
    beat = (b - a) / 8
    Bb4, Db5, C5, A4 = 466.2, 554.4, 523.3, 440.0
    Bb1, Bb2, Db3, F3 = 58.3, 116.5, 138.6, 174.6
    mel = [(0, Bb4), (1, Bb4), (1.75, Bb4), (2, Bb4), (4, Db5), (5, C5), (5.75, Bb4), (6, Bb4), (6.75, A4), (7, Bb4)]
    buf = np.zeros(n_(b - a + 3))
    for bt, f in mel:
        put(buf, piano_note(f, 0.6, 0.55, staccato=True), bt * beat)
        put(buf, piano_note(f / 2, 0.6, 0.3, staccato=True), bt * beat)
    for bt in range(8):
        if bt % 2 == 0:
            put(buf, piano_note(Bb1, 0.6, 0.5, staccato=True), bt * beat)
            put(buf, piano_note(Bb2, 0.6, 0.35, staccato=True), bt * beat)
        else:
            put(buf, piano_note(Db3, 0.6, 0.3, staccato=True), bt * beat)
            put(buf, piano_note(F3, 0.6, 0.3, staccato=True), bt * beat)
    # Acorde final seco (si bemol menor) justo en el tercer golpe
    for f in [Bb1, Bb2, Db3, F3, 233.1, 277.2, 349.2, 466.2]:
        put(buf, piano_note(f, 0.5, 0.42, staccato=True), 8 * beat)
    wet = reverb(buf, 1.0, 0.18)
    out = np.zeros(n_(TOTAL))
    put(out, wet, a)
    return out


def gate(buf, a, b, ramp=0.004):
    i, j = n_(a), min(len(buf), n_(b))
    buf[i:j] = 0
    r = n_(ramp)
    buf[max(0, i - r):i] *= np.linspace(1, 0, i - max(0, i - r))
    buf[j:j + r] *= np.linspace(0, 1, len(buf[j:j + r]))


def write(path, x):
    x = np.clip(x, -1, 1)
    data = (np.stack([x, x], axis=1) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


def master_lufs(src, dst, target=-14.0):
    """Master a −14 LUFS integrados con ffmpeg loudnorm en dos pasadas (techo −1 dBTP)."""
    import subprocess
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(src), "-af",
                        f"loudnorm=I={target}:TP=-1:LRA=20:print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True)
    txt = r.stderr
    m = json.loads(txt[txt.rindex("{"):txt.rindex("}") + 1])
    af = (f"loudnorm=I={target}:TP=-1:LRA=20:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
          f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-af", af, "-ar", str(SR), "-c:a", "pcm_s16le", str(dst)], check=True)
    src.unlink()


def build():
    sfx = np.zeros(n_(TOTAL))
    amb = np.zeros(n_(TOTAL))

    # 1. Gancho
    put(sfx, clack(), T["clack1"], 0.9)
    put(sfx, clack(), T["clack2"], 0.95)
    a, b = T["hum"]
    put(amb, hum(b - a), a, 0.05)
    # 2. Acusación
    for i, lt in enumerate(notif_times()):
        put(sfx, ping(1320 if i % 2 else 1760), T["s2"] + lt, 0.16 + 0.12 * min(1, i / 30))
    for g in T["glitch"]:
        put(sfx, glitch(0.14), g, 0.5)
    # 3. Giro
    a, b = T["giro"]
    put(sfx, whoosh(b - a, 120, 900, dark=True), a, 0.7)
    put(sfx, kick(45, 0.9), b, 1.0)
    # 4. Corto ≠ Breve
    put(sfx, whoosh(0.35, 400, 6000), T["s4"], 0.5)
    put(sfx, metal_hit(), T["choque"], 0.95)
    for tr in T["trazos"]:
        put(sfx, marker(), tr, 0.45)
    put(sfx, whoosh(0.3, 300, 3000), T["split"], 0.35)
    for i in range(9):
        put(sfx, tick_type() * 0.8, T["caen"] + i * 0.05, 0.35)
    a, b = T["arena"]
    put(sfx, sand(b - a), a, 0.6)
    put(sfx, click_lock(), T["encastre"], 0.8)
    # 5. Chéjov
    t0, step, count = T["tipeo"]
    for i in range(count):
        put(sfx, tick_type(), t0 + i * step, 0.28)
    a, b = T["cuerda"]
    put(sfx, cello(b - a, 55), a, 0.3)
    # 6. Scroll
    for st in swipe_times():
        put(sfx, swipe(), T["s6"] + st, 0.28)
    # 7. Frenada: impacto con reverb larga, después silencio y sala
    imp = brutal_impact()
    # La cola de la reverb se apaga antes de que aparezca "EN EL TEATRO NO HAY SCROLL"
    lim = n_(T["texto7"] - T["s7"])
    fade = np.ones(len(imp))
    fade[int(lim * 0.55):lim] = np.linspace(1, 0.02, lim - int(lim * 0.55))
    fade[lim:] = 0.02
    put(sfx, imp * fade, T["s7"], 1.0)
    a, b = T["sala"]
    sala = room(b - a)
    # Murmullo apenas audible bajo el texto quieto; un poco más presente después
    curva = np.where(tt(b - a) < (T["s8"] - a), 0.012, 0.03)
    put(amb, sala * curva, a)
    # 8. Latidos
    for lt in T["latidos"]:
        put(sfx, heartbeat(), lt, 0.9)
    # 9. Gracián: acorde barroco y remate cómico
    put(sfx, harpsichord([196.0, 246.9, 293.7, 392.0]), T["clave"], 0.55)
    put(sfx, pizz_boop(), T["boop"], 0.6)
    # 10. Apagón
    put(sfx, clack(), T["apagon"], 0.95)
    # 11. Placa: tercera llamada y murmullo de sala
    for gt in T["golpes"]:
        put(sfx, wood_knock(), gt, 0.95)
    for pt in T["paneos"]:
        put(sfx, whoosh(0.5, 200, 1800), pt, 0.22)
    a, b = T["murmullo"]
    put(amb, crowd(b - a), a, 0.16)

    mus = electronica() + piano_solo() + chopin()
    # Silencio total en el corte a negro de la escena 2
    for buf in (sfx, amb, mus):
        gate(buf, *T["negro"])
    # Después del apagón, nada hasta la placa (salvo el clack)
    gate(amb, T["apagon"], T["placa"] - 0.2)
    sfx_n, mus_n = norm(sfx, 0.9), norm(mus, 0.28)  # música ≈ −10 dB por debajo de los efectos
    amb = amb.clip(-1, 1)
    write(ROOT / "assets/audio/musica.wav", mus_n)
    write(ROOT / "assets/audio/sfx.wav", sfx_n)
    write(ROOT / "assets/audio/ambiente.wav", amb)
    mezcla = sfx_n + mus_n + amb
    write(ROOT / "tools/mezcla.wav", norm(mezcla, 0.95))
    master_lufs(ROOT / "tools/mezcla.wav", ROOT / "assets/audio/master.wav")
    (ROOT / "tools/cues.json").write_text(json.dumps(
        {"notif": notif_times(), "swipes": swipe_times(), **{k: v for k, v in T.items()}}, indent=1))


if __name__ == "__main__":
    build()
    print("notif", len(notif_times()), notif_times()[:6], "...", notif_times()[-3:])
    print("swipes", swipe_times())
