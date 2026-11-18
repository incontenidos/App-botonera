# Video: Ciclo Volante — función de hoy

Reel/Story vertical de 15 s hecho con HyperFrames. Render: `ciclo-volante-hoy.mp4`.

## Placeholders para reemplazar

Instagram no fue accesible desde la sesión, así que estos elementos están marcados:

| Qué | Dónde |
|---|---|
| Colores del ciclo | `index.html`, bloque `:root` (`--rojo`, `--crema`, `--mostaza`, `--fondo`) |
| Logo del ciclo | `compositions/ciclo.html`, `#c-logo` (poner `assets/logo.png` en un `<img>`) |
| Títulos de las otras obras | `compositions/ciclo.html`, `#c-obra1`, `#c-obra3`, `#c-obra4` |
| Fotos de Renata, Mora y Dante | `compositions/novicia.html`, los círculos `.n-foto` |
| Tipografía del ciclo | fuente en `assets/fonts/` + `@font-face` en cada escena |

## Audio

Música, tic-tac y campanada son originales, sintetizados con `tools/make_audio.py`
(sin derechos de terceros). Para regenerarlos: `python3 tools/make_audio.py assets/audio`.
Para usar otra música, reemplazá `assets/audio/musica.wav`.

## Volver a renderizar

`npx hyperframes render --quality delivery --output ciclo-volante-hoy.mp4`
