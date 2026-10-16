// Uso: npm run version:set -- 1.4
// Cambia el número de versión en todos los archivos (evita que el navegador mezcle versiones viejas y nuevas).
import { readFileSync, writeFileSync } from 'node:fs';

const v = process.argv[2];
if (!/^\d+\.\d+(\.\d+)?$/.test(v || '')) {
  console.error('Indicá la versión, por ejemplo: npm run version:set -- 1.4');
  process.exit(1);
}
const files = ['index.html', 'sw.js', 'src/app.js', 'src/show.js', 'src/show-engine.js'];
for (const f of files) {
  const s = readFileSync(f, 'utf8')
    .replace(/\?v=\d+\.\d+(\.\d+)?/g, `?v=${v}`)
    .replace(/const VERSION = '[^']+';/, `const VERSION = '${v}';`)
    .replace(/· v\d+\.\d+(\.\d+)?/, `· v${v}`)
    .replace(/Versión \d+\.\d+(\.\d+)?/, `Versión ${v}`);
  writeFileSync(f, s);
}
console.log(`Versión ${v} aplicada.`);
