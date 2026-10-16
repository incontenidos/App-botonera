# 🔊 Botonera

Botonera de sonidos personalizada. Cada persona arma la suya con:

- **Audios propios**: MP3, M4A, WAV, OGG, videos (usa el audio), etc.
- **Audios de WhatsApp**: notas de voz `.opus` y audios reenviados.
- **YouTube**: pegás el link (respeta `?t=` para arrancar en un segundo exacto) y podés recortar desde/hasta.
- **Spotify**: temas, episodios, álbumes o playlists.
- **Grabación** con el micrófono.
- **Links directos** a un audio (si el sitio lo permite, se descarga para usarlo sin conexión).

Desarrollada por **Marian Morelli**.

Es una **PWA** (app web instalable): se instala en Android, iPhone y la compu, funciona sin internet
y guarda todo **en el dispositivo** (IndexedDB). No necesita servidor ni cuentas.

## 🎭 Modo Función (para obras de teatro)

Una segunda pantalla, tipo Multiplay/QLab, para pasar el sonido de una función con un solo botón **GO**:

- **Lista de cues** por obra (se pueden tener varias funciones guardadas). Se cargan varios audios de una
  vez (quedan ordenados por nombre: `01 …`, `02 …`) o se traen desde la botonera.
- **Volumen en dB** por cue, relativo al original: se puede **subir** (hasta +12 dB) o bajar (−60 dB = silencio).
- **Continuación** por cue: *espera el próximo GO*, *al terminar entra el siguiente* (continuado) o
  *el siguiente entra junto con este*.
- **Blackout sonoro**: cue que detiene todo lo que suena, con corte seco o fundido de N segundos.
- **Loop** por cue, **fundidos** de entrada y salida, **recorte** desde/hasta.
- **GO** (barra espaciadora), **STOP ALL** (Esc), **FADE ALL** (F, duración configurable), ↑/↓ para elegir el cue en espera.
  Se ve qué está sonando con tiempo restante y se puede parar o fundir cada uno.
- Protección contra doble GO, pantalla siempre encendida durante la función y edición bloqueada
  (✏️) para no cambiar nada por error.
- **Exportar/importar** la función entera (con los audios) para llevarla a la compu del teatro.

## Agregar audios es fácil

| Desde | Cómo |
|---|---|
| **WhatsApp (Android)** | Mantené apretado el audio → **Compartir** → **Botonera**. Se abre con el nombre ya puesto. |
| **WhatsApp (iPhone)** | Mantené apretado → Reenviar → Compartir → *Guardar en Archivos*. Después **＋ → Audio del dispositivo**. |
| **YouTube / Spotify (celu)** | Botón **Compartir** de la app → **Botonera** (Android), o copiá el link y tocá **Pegar**. |
| **Compu** | Arrastrá archivos a la ventana, o pegá (Ctrl+V) un link o un audio. |
| **Varios a la vez** | Elegí o arrastrá varios archivos: se agregan todos de una. |

Otras cosas: tocar = sonar / volver a tocar = parar; **toque largo** o ✏️ para editar (nombre, emoji,
color, recorte, volumen, loop, orden); teclas **1–0** disparan los primeros 10 botones y **Esc** para todo;
**exportar/importar** la botonera como `.json` (incluye los audios) para pasarla a otro dispositivo.

## Correrla

No tiene dependencias ni build: son archivos estáticos.

```bash
npm start      # sirve en http://localhost:5173
npm test       # tests de reconocimiento de links / archivos
```

Para usarla en el celular hay que publicarla con **HTTPS** (requisito de las PWAs): GitHub Pages,
Netlify, Vercel, Cloudflare Pages, etc. Basta con subir la carpeta tal cual (funciona también en una subcarpeta).

## Cómo funciona

```
index.html, styles.css
src/app.js       interfaz y flujos para agregar/editar
src/sources.js   reconoce links de YouTube/Spotify, tiempos ("1:23", "1m23s") y archivos de WhatsApp
src/player.js    reproduce audio local (varios a la vez) y YouTube/Spotify con sus reproductores oficiales
src/recorder.js  grabación con el micrófono
src/show.js      Modo Función (lista de cues, GO, edición)
src/show-engine.js  motor de audio de la función (Web Audio: dB, fundidos, loop, blackout)
src/cues.js      lógica pura de cues (dB, encadenamiento), con tests
src/db.js        guardado local (IndexedDB)
sw.js            offline + recibe lo que se comparte desde otras apps (Web Share Target)
manifest.webmanifest  instalación y registro en el menú "Compartir"
```

## Limitaciones a tener en cuenta

- **YouTube y Spotify no se descargan**: sus condiciones de uso no lo permiten (y Spotify tiene DRM).
  Se reproducen con sus reproductores embebidos oficiales, que aparecen en un panel abajo; necesitan
  internet, suenan de a uno y algunos videos no permiten reproducirse fuera de YouTube. En Spotify, sin
  sesión iniciada en el navegador suena una vista previa de 30 segundos. Para tener un audio propio sin
  conexión, usá la opción de grabar o un archivo.
- **"Compartir → Botonera"** (Web Share Target) funciona en Android con Chrome/Edge/Samsung Internet
  después de instalar la app. iPhone (Safari) todavía no lo soporta: ahí se usa *Guardar en Archivos*.
- Las notas de voz de WhatsApp son Ogg/Opus; algunos navegadores viejos (sobre todo Safari en iOS
  antiguos) no las reproducen. La app avisa cuando el formato no es compatible.
- Los audios quedan en el navegador del dispositivo: si se borran los datos del sitio, se pierden.
  Usá **Exportar botonera** como respaldo.
