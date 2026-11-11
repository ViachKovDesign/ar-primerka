// Проверка всех GLB официальным валидатором Khronos (gltf-validator).
// Scene Viewer (Android) не открывает модели с ошибками валидации, поэтому сборка
// падает при любой ошибке. Предупреждения печатаются, но не мешают.
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const validator = createRequire(import.meta.url)('gltf-validator');
let errors = 0;

for (const dir of await readdir('models')) {
  for (const f of (await readdir(join('models', dir))).filter((n) => n.endsWith('.glb'))) {
    const p = join('models', dir, f);
    const { issues, info } = await validator.validateBytes(new Uint8Array(await readFile(p)));
    errors += issues.numErrors;
    console.log(`${issues.numErrors ? '✗' : '✓'} ${p.padEnd(38)} ошибок ${issues.numErrors}, предупреждений ${issues.numWarnings}, треугольников ${info.totalTriangleCount}, материалов ${info.materialCount}`);
    for (const m of issues.messages.filter((m) => m.severity === 0)) console.log(`    ${m.code}: ${m.message} ${m.pointer ?? ''}`);
  }
}
if (errors) { console.error(`Ошибок валидации: ${errors}`); process.exit(1); }
console.log('Все модели проходят glTF-валидатор без ошибок.');
