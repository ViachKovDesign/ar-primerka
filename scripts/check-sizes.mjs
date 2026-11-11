// Проверка требования: каждая модель не больше 3 МБ. Заодно печатает габариты в метрах.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/core';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const LIMIT = 3 * 1024 * 1024;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
let failed = false;

for (const dir of await readdir('models')) {
  for (const f of (await readdir(join('models', dir))).filter((n) => /\.(glb|usdz)$/.test(n))) {
    const p = join('models', dir, f);
    const { size } = await stat(p);
    let dims = '';
    if (f.endsWith('.glb')) {
      const doc = await io.read(p);
      const { min, max } = getBounds(doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]);
      dims = `  ${[0, 2, 1].map((i) => ((max[i] - min[i]) * 100).toFixed(0)).join('×')} см (Ш×Г×В), низ y=${min[1].toFixed(3)}`;
    }
    const ok = size <= LIMIT;
    failed ||= !ok;
    console.log(`${ok ? '✓' : '✗'} ${p.padEnd(38)} ${(size / 1024 / 1024).toFixed(2)} МБ${dims}`);
  }
}
if (failed) { console.error('Есть модели тяжелее 3 МБ'); process.exit(1); }
console.log('Все модели ≤ 3 МБ.');
