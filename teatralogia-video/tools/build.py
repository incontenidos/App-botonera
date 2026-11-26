"""Genera las escenas HTML, index.html y el audio del reel de TEATRALOGÍA desde una sola tabla de tiempos.

Uso: python3 tools/build.py   (desde la carpeta del proyecto)
Para cambiar un tiempo, editá SCENES y volvé a correrlo; el audio se regenera alineado a los cortes.
"""
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
W, H = 1080, 1920
GRIS = "#888888"

# (id, inicio, duración). Escena 10 = negro total (sin escena).
SCENES = [
    ("s01-atencion", 0.0, 4.6),
    ("s02-reves", 4.6, 2.8),
    ("s03-corto-breve", 7.4, 2.3),
    ("s04-definicion", 9.7, 5.1),
    ("s05-chejov", 14.8, 3.2),
    ("s06-scroll", 18.0, 4.0),
    ("s07-teatro", 22.0, 2.6),
    ("s08-estar", 24.6, 3.4),
    ("s09-gracian", 28.0, 5.4),
    ("s11-placa", 33.9, 5.1),
]
NEGRO = (33.4, 33.9)        # corte a negro total (punto 10)
TOTAL = 39.0
SILENCIO = (22.0, 28.0)     # punto 7: el sonido se corta; vuelve en Gracián
FIN_SONIDO = NEGRO[0]       # termina seco en el corte a negro

FONT_FACES = """
    @font-face { font-family: "DM Sans"; font-weight: 300; font-style: italic; src: url("assets/fonts/dm-sans-latin-300-italic.woff2") format("woff2"); }
    @font-face { font-family: "DM Sans"; font-weight: 400; font-style: normal; src: url("assets/fonts/dm-sans-latin-400-normal.woff2") format("woff2"); }
    @font-face { font-family: "DM Sans"; font-weight: 700; font-style: normal; src: url("assets/fonts/dm-sans-latin-700-normal.woff2") format("woff2"); }"""

BASE_CSS = FONT_FACES + """
    #root { position: absolute; inset: 0; background: #000; color: #fff; font-family: "DM Sans", sans-serif; }
    /* Zona de texto: dentro de la franja segura de Reels (380–1330 px), margen izquierdo de 110 px */
    .zona { position: absolute; left: 110px; width: 800px; top: 380px; height: 950px;
      display: flex; flex-direction: column; justify-content: center; }
    .b { font-weight: 700; }
    .r { font-weight: 400; }
    .q { font-weight: 300; font-style: italic; }
    .gris { color: #888888; }
    .linea { display: block; }
    .w { opacity: 0; }
    .m { display: block; overflow: hidden; padding-bottom: 0.12em; margin-bottom: -0.12em; }
    .mi { display: block; }"""


def words(text, cls, prefix):
    """Una línea con cada palabra en su span (para aparición palabra por palabra)."""
    out = []
    for i, word in enumerate(text.split(" ")):
        out.append(f'<span class="w" id="{prefix}-w{i}">{word}</span>')
    return f'<span class="linea {cls}">' + " ".join(out) + "</span>", len(out)


def masked(lines, prefix):
    """Líneas que entran con máscara (cada línea sube desde debajo de su caja)."""
    out = []
    for i, text in enumerate(lines):
        out.append(f'<span class="m"><span class="mi" id="{prefix}-l{i}">{text}</span></span>')
    return "\n".join(out)


def word_tweens(prefix, n, t0, step):
    js = []
    for i in range(n):
        js.append(f'appear("#{prefix}-w{i}", {t0 + i * step:.2f});')
    return "\n    ".join(js)


def mask_tweens(prefix, n, t0, step=0.12, dur=0.38):
    return "\n    ".join(
        f'tl.fromTo("#{prefix}-l{i}", {{ yPercent: 105 }}, {{ yPercent: 0, duration: {dur}, ease: "power3.out" }}, {t0 + i * step:.2f});'
        for i in range(n))


HELPERS = """
    // Aparición seca (sin fundido) y corte duro, ambos reversibles al buscar en la línea de tiempo
    const appear = (sel, t) => tl.fromTo(sel, { opacity: 0 }, { opacity: 1, duration: 0.001, immediateRender: false }, t);
    const cut = (sel, t) => tl.fromTo(sel, { opacity: 1 }, { opacity: 0, duration: 0.001, immediateRender: false }, t);"""


def scene(cid, css, body, js):
    return f"""<template>
  <style>{BASE_CSS}
{css}
  </style>
  <div id="root" data-composition-id="{cid}" data-width="{W}" data-height="{H}">
{body}
  </div>
  <script>
    const tl = gsap.timeline({{ paused: true }});{HELPERS}
    {js}
    window.__timelines["{cid}"] = tl;
  </script>
</template>
"""


def build_scenes():
    s = {}

    # 1. Palabra por palabra; corte duro a la segunda frase
    a, na = words("Dicen que nos gusta lo breve", "b", "s1a")
    b, nb = words("porque ya no sabemos prestar atención.", "r", "s1b")
    a = a.replace('class="w" id="s1a-w0"', 'id="s1a-w0"')
    s["s01-atencion"] = scene("s01-atencion", """
    #s1-a, #s1-b { font-size: 96px; line-height: 1.08; letter-spacing: -0.02em; }
    #s1-b { font-size: 84px; }""", f"""    <div class="zona"><div id="s1-a">{a}</div></div>
    <div class="zona"><div id="s1-b">{b}</div></div>""",
        "// La primera palabra ya está en el fotograma 0 (es la miniatura del reel)\n    "
        + word_tweens("s1a", na, 0.05, 0.22).split("\n", 1)[1].strip()
        + "\n    cut(\"#s1-a\", 2.2);\n    " + word_tweens("s1b", nb, 2.25, 0.2))

    # 2. Más grande, entra con máscara y queda quieto (pausa)
    s["s02-reves"] = scene("s02-reves", """
    #s2 { font-size: 132px; line-height: 1.02; letter-spacing: -0.03em; }""",
        f'    <div class="zona"><div id="s2" class="b">{masked(["Yo creo que", "es al revés."], "s2")}</div></div>',
        mask_tweens("s2", 2, 0.0))

    # 3. CORTO ≠ BREVE: las palabras separadas y el ≠ se dibuja entre ellas
    s["s03-corto-breve"] = scene("s03-corto-breve", """
    .s3-p { position: absolute; left: 110px; width: 800px; text-align: center; font-size: 150px; letter-spacing: 0.04em; }
    #s3-corto { top: 520px; }
    #s3-breve { top: 1010px; }
    #s3-neq { position: absolute; left: 440px; top: 760px; width: 140px; height: 180px; }""", """    <div class="s3-p b" id="s3-corto">CORTO</div>
    <svg id="s3-neq" viewBox="0 0 140 180" fill="none" stroke="#ffffff" stroke-width="14" stroke-linecap="square">
      <line id="s3-l1" x1="10" y1="68" x2="130" y2="68" pathLength="1" stroke-dasharray="1" />
      <line id="s3-l2" x1="10" y1="112" x2="130" y2="112" pathLength="1" stroke-dasharray="1" />
      <line id="s3-l3" x1="100" y1="10" x2="40" y2="170" pathLength="1" stroke-dasharray="1" />
    </svg>
    <div class="s3-p b" id="s3-breve">BREVE</div>""", """appear("#s3-corto", 0);
    appear("#s3-breve", 0.35);
    tl.fromTo("#s3-l1", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.22, ease: "power2.inOut" }, 0.7);
    tl.fromTo("#s3-l2", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.22, ease: "power2.inOut" }, 0.86);
    tl.fromTo("#s3-l3", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.26, ease: "power2.inOut" }, 1.06);""")

    # 4. Regular → corte → Bold palabra por palabra
    b4, n4 = words("Breve es lo que no tiene nada de más.", "b", "s4b")
    # Cortes de línea fijos para que no quede "más." sola
    b4 = b4.replace('<span class="w" id="s4b-w4">', '<br /><span class="w" id="s4b-w4">').replace('<span class="w" id="s4b-w7">', '<br /><span class="w" id="s4b-w7">')
    s["s04-definicion"] = scene("s04-definicion", """
    #s4-a { font-size: 80px; line-height: 1.1; letter-spacing: -0.01em; }
    #s4-b { font-size: 100px; line-height: 1.06; letter-spacing: -0.02em; }""",
        f"""    <div class="zona"><div id="s4-a" class="r">{masked(["Corto es lo que", "termina rápido."], "s4a")}</div></div>
    <div class="zona"><div id="s4-b">{b4}</div></div>""",
        mask_tweens("s4a", 2, 0.0) + "\n    cut(\"#s4-a\", 2.2);\n    " + word_tweens("s4b", n4, 2.2, 0.14))

    # 5. Cita de Chéjov
    s["s05-chejov"] = scene("s05-chejov", """
    #s5-q { font-size: 88px; line-height: 1.1; }
    #s5-f { margin-top: 48px; font-size: 40px; }""",
        f"""    <div class="zona">
      <div id="s5-q" class="q">{masked(["“La brevedad", "es hermana", "del talento.”"], "s5")}</div>
      <div id="s5-f" class="r gris">— Chéjov</div>
    </div>""",
        mask_tweens("s5", 3, 0.0, 0.14) + "\n    appear(\"#s5-f\", 1.0);")

    # 6. Scroll: la columna sube en línea recta y se frena de golpe
    s["s06-scroll"] = scene("s06-scroll", """
    #s6-ventana { position: absolute; left: 110px; width: 800px; top: 380px; height: 950px; overflow: hidden; }
    #s6-col { position: absolute; left: 0; width: 800px; top: 0; }
    .s6-t { height: 950px; display: flex; align-items: center; font-size: 96px; line-height: 1.08; letter-spacing: -0.02em; }""",
        """    <div id="s6-ventana" data-layout-allow-overflow>
      <div id="s6-col">
        <div class="s6-t b" id="s6-a">El scroll también es breve.</div>
        <div class="s6-t r" id="s6-b">Pero siempre te deja escapar.</div>
      </div>
    </div>""", """// Entra desde abajo como un swipe y se clava; después otro swipe a la segunda frase
    tl.fromTo("#s6-col", { y: 950 }, { y: 0, duration: 0.28, ease: "none" }, 0);
    tl.to("#s6-col", { y: -950, duration: 0.28, ease: "none" }, 1.95);""")

    # 7. Quieto, sin animación
    s["s07-teatro"] = scene("s07-teatro", """
    #s7 { font-size: 124px; line-height: 1.02; letter-spacing: -0.03em; }""",
        '    <div class="zona"><div id="s7" class="b"><span class="linea">En el teatro</span><span class="linea">no hay scroll.</span></div></div>',
        "// Sin animación: la inmovilidad es el efecto")

    # 8. Regular → corte → Bold
    b8, n8 = words("Te obliga a estar.", "b", "s8b")
    s["s08-estar"] = scene("s08-estar", """
    #s8-a { font-size: 84px; line-height: 1.1; }
    #s8-b { font-size: 120px; line-height: 1.04; letter-spacing: -0.03em; }""",
        f"""    <div class="zona"><div id="s8-a" class="r">{masked(["Lo breve", "no te distrae."], "s8a")}</div></div>
    <div class="zona"><div id="s8-b">{b8}</div></div>""",
        mask_tweens("s8a", 2, 0.0) + "\n    cut(\"#s8-a\", 1.8);\n    " + word_tweens("s8b", n8, 1.8, 0.18))

    # 9. Cita de Gracián, pausa, y el remate más chico
    s["s09-gracian"] = scene("s09-gracian", """
    #s9-q { font-size: 84px; line-height: 1.1; }
    #s9-f { margin-top: 40px; font-size: 38px; }
    #s9-r { margin-top: 90px; font-size: 52px; line-height: 1.2; }""",
        f"""    <div class="zona">
      <div id="s9-q" class="q">{masked(["“Lo bueno, si breve,", "dos veces bueno.”"], "s9")}</div>
      <div id="s9-f" class="r gris">— Baltasar Gracián, 1647</div>
      <div id="s9-r" class="q">{masked(["y aun lo malo, si poco,", "no tan malo."], "s9r")}</div>
    </div>""",
        mask_tweens("s9", 2, 0.0, 0.14) + "\n    appear(\"#s9-f\", 0.9);\n    " + mask_tweens("s9r", 2, 2.9, 0.14))

    # 11. Placa final
    s["s11-placa"] = scene("s11-placa", """
    #s11 { position: absolute; left: 110px; width: 800px; top: 380px; height: 950px;
      display: flex; flex-direction: column; justify-content: center; text-align: center; }
    #s11-t { font-size: 116px; letter-spacing: 0.01em; line-height: 1; }
    #s11-s { margin-top: 18px; font-size: 46px; }
    #s11-o { margin-top: 90px; font-size: 46px; line-height: 1.25; }
    #s11-d { margin-top: 14px; font-size: 40px; }
    #s11-i { margin-top: 70px; font-size: 38px; line-height: 1.35; }
    #s11-h { margin-top: 70px; font-size: 40px; }""", """    <div id="s11">
      <div id="s11-t" class="b">TEATRALOGÍA</div>
      <div id="s11-s" class="r gris">ciclo de obras breves</div>
      <div id="s11-o" class="b">El Velorio de Roberto<br /><span class="r">— de Azul Haure</span></div>
      <div id="s11-d" class="r">Dirección: Marian Morelli</div>
      <div id="s11-i" class="r">Viernes 21 h · El Piso Teatro<br />Hidalgo 878<br />Hasta el 18/12</div>
      <div id="s11-h" class="b">@teatralogia.ciclo</div>
    </div>""", """// La marca aparece seca; el resto entra en cascada corta
    appear("#s11-t", 0);
    ["#s11-s", "#s11-o", "#s11-d", "#s11-i", "#s11-h"].forEach((sel, i) => appear(sel, 0.35 + i * 0.18));""")
    return s


def build_clock():
    freeze = NEGRO[0]
    return f"""<template>
  <style>{FONT_FACES}
    #root {{ position: absolute; inset: 0; font-family: "DM Sans", sans-serif; }}
    /* Esquina superior derecha, debajo de la barra de Reels */
    #reloj-t {{ position: absolute; right: 110px; top: 300px; font-weight: 400; font-size: 34px;
      color: #888888; letter-spacing: 0.06em; font-variant-numeric: tabular-nums; }}
  </style>
  <div id="root" data-composition-id="reloj" data-width="{W}" data-height="{H}">
    <div id="reloj-t">00:00</div>
  </div>
  <script>
    const tl = gsap.timeline({{ paused: true }});
    // Corre con el video y se congela al llegar al corte a negro ({freeze} s)
    const t = {{ s: 0 }};
    const pinta = () => {{
      const v = Math.floor(t.s);
      document.querySelector("#reloj-t").textContent =
        String(Math.floor(v / 60)).padStart(2, "0") + ":" + String(v % 60).padStart(2, "0");
    }};
    tl.fromTo(t, {{ s: 0 }}, {{ s: {freeze}, duration: {freeze}, ease: "none", onUpdate: pinta }}, 0);
    // Corte a negro: desaparece y vuelve congelado en la placa final
    tl.fromTo("#reloj-t", {{ opacity: 1 }}, {{ opacity: 0, duration: 0.001, immediateRender: false }}, {NEGRO[0]});
    tl.fromTo("#reloj-t", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.001, immediateRender: false }}, {NEGRO[1]});
    window.__timelines["reloj"] = tl;
  </script>
</template>
"""


def build_index():
    hosts = []
    for cid, start, dur in SCENES:
        hosts.append(f'''      <div id="{cid}" data-composition-id="{cid}" data-composition-src="compositions/{cid}.html"
        data-start="{start}" data-duration="{dur}" data-track-index="1" data-track-kind="graphics"
        data-width="{W}" data-height="{H}"></div>''')
    return f"""<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width={W}, height={H}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      html, body {{ width: {W}px; height: {H}px; overflow: hidden; background: #000; }}
      #root {{ width: 100%; height: 100%; }}
      #fondo {{ position: absolute; inset: 0; background: #000; }}
    </style>
  </head>
  <body>
    <!-- Generado por tools/build.py: editá los tiempos ahí y volvé a correrlo -->
    <div id="root" data-composition-id="main" data-start="0" data-duration="{TOTAL}"
      data-width="{W}" data-height="{H}">
      <div id="fondo"></div>
{chr(10).join(hosts)}
      <!-- Corte a negro total: {NEGRO[0]}–{NEGRO[1]} s (no hay escena) -->
      <div id="reloj" data-composition-id="reloj" data-composition-src="compositions/reloj.html"
        data-start="0" data-duration="{TOTAL}" data-track-index="2" data-track-kind="graphics"
        data-width="{W}" data-height="{H}"></div>
      <!-- Sonido original sintetizado por tools/build.py -->
      <audio id="pulso" class="clip" data-start="0" data-duration="{TOTAL}" data-track-index="3"
        data-volume="1" src="assets/audio/pulso.wav"></audio>
    </div>
    <script>
      window.__timelines = window.__timelines || {{}};
      window.__timelines["main"] = gsap.timeline({{ paused: true }});
    </script>
  </body>
</html>
"""


# ---------------- Audio ----------------
SR = 44100


def env(n, attack, decay):
    t = np.arange(n) / SR
    return np.minimum(1, t / attack) * np.exp(-t / decay)


def add(buf, sig, at, gain):
    i = int(at * SR)
    j = min(len(buf), i + len(sig))
    if j > i:
        buf[i:j] += sig[: j - i] * gain


def thump(f0=52, dur=0.5, decay=0.11):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f0 + 40 * np.exp(-t / 0.03)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.003, decay)


def tick():
    n = int(0.03 * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(3)
    s = np.sin(2 * np.pi * 3200 * t) * 0.6 + rng.standard_normal(n) * 0.4
    return s * env(n, 0.0004, 0.004)


def build_audio():
    n = int(TOTAL * SR)
    buf = np.zeros(n)
    t = np.arange(n) / SR
    # Dron grave muy bajo, con batido lento: tensión de fondo
    drone = (np.sin(2 * np.pi * 55 * t) + 0.6 * np.sin(2 * np.pi * 55.7 * t) + 0.25 * np.sin(2 * np.pi * 110.3 * t))
    buf += drone * 0.035
    # Pulso grave en cada segundo (cuando cambia el cronómetro) y tic sutil a mitad de segundo
    for k in range(int(TOTAL) + 1):
        add(buf, thump(), k, 0.32)
        add(buf, tick(), k + 0.5, 0.06)
    # Golpe más marcado en cada corte de escena
    for _, start, _ in SCENES[1:]:
        add(buf, thump(44, 0.7, 0.18), start, 0.5)
    # Silencio total en el punto 7 y después del corte a negro (cortes secos, 5 ms para evitar clicks)
    gate = np.ones(n)
    ramp = int(0.005 * SR)

    def mute(a, b):
        i, j = int(a * SR), min(n, int(b * SR))
        gate[i:j] = 0
        gate[max(0, i - ramp):i] = np.minimum(gate[max(0, i - ramp):i], np.linspace(1, 0, i - max(0, i - ramp)))
        if j < n:
            gate[j:j + ramp] = np.minimum(gate[j:j + ramp], np.linspace(0, 1, min(ramp, n - j)))

    mute(*SILENCIO)
    mute(FIN_SONIDO, TOTAL)
    buf *= gate
    buf = buf / np.max(np.abs(buf)) * 0.7
    data = (np.stack([buf, buf], axis=1) * 32767).astype(np.int16)
    with wave.open(str(ROOT / "assets/audio/pulso.wav"), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


if __name__ == "__main__":
    for cid, html in build_scenes().items():
        (ROOT / "compositions" / f"{cid}.html").write_text(html, encoding="utf-8")
    (ROOT / "compositions/reloj.html").write_text(build_clock(), encoding="utf-8")
    (ROOT / "index.html").write_text(build_index(), encoding="utf-8")
    build_audio()
    print("ok")
