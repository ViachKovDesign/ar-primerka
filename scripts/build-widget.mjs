// Сборка ленивых частей виджета: widget/engine/{mv,xr,qr}.js + общий кусок three.js.
// Сам виджет widget/ar-viewer.js не собирается — это обычный файл, его можно править руками.
// Запуск: npm run widget
//
// 'three' и 'three/addons/…' берутся из node_modules/three — той же версии, из которой
// scripts/copy-vendor.mjs скопировал vendor/three для демо.
// esbuild-wasm на Node 24 зацикливается, если его вывод идёт в файл (RangeError: Invalid array
// length в fs.writeSync), поэтому stdout/stderr берём через канал и печатаем сами.
import { execFileSync } from 'node:child_process';
import { rm, readdir, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const OUT = 'widget/engine';
await rm(OUT, { recursive: true, force: true });
const log = execFileSync(process.execPath, [
  'node_modules/esbuild-wasm/bin/esbuild',
  'mv=widget/src/mv.js', 'xr=widget/src/xr.js', 'qr=widget/src/qr.js',
  `--outdir=${OUT}`,
  '--bundle', '--splitting', '--format=esm', '--minify', '--target=es2020',
  '--chunk-names=chunk-[hash]',
  '--legal-comments=none', // лицензии — в vendor/LICENSE-*.txt и CREDITS.md
  '--log-level=warning',
], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
if (log.trim()) console.log(log);

const kb = (n) => `${(n / 1024).toFixed(1)} КБ`;
const files = ['widget/ar-viewer.js', ...(await readdir(OUT)).sort().map((f) => `${OUT}/${f}`)];
let total = 0, totalGz = 0;
for (const f of files) {
  const buf = await readFile(f);
  const gz = gzipSync(buf, { level: 9 }).length;
  if (f.startsWith(OUT)) { total += buf.length; totalGz += gz; }
  console.log(`${f.padEnd(36)} ${kb(buf.length).padStart(10)}   gzip ${kb(gz).padStart(9)}`);
}
console.log(`${'widget/engine/ всего'.padEnd(36)} ${kb(total).padStart(10)}   gzip ${kb(totalGz).padStart(9)}`);
