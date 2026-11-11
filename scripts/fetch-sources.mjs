// Скачивает исходные модели Poly Haven (CC0) в разрешении 1k в папку sources/.
// sources/ не публикуется — это сырьё для scripts/build-models.mjs.
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const ASSETS = ['ArmChair_01', 'coffee_table_round_01'];
const RES = '1k';
const UA = { 'User-Agent': 'ar-primerka-build/0.1' };

async function exists(p) { try { await access(p); return true; } catch { return false; } }

async function download(url, dest) {
  if (await exists(dest)) return;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  console.log('  ↓', dest);
}

for (const id of ASSETS) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`, { headers: UA })).json();
  const gltf = files.gltf?.[RES]?.gltf;
  if (!gltf) throw new Error(`Нет glTF ${RES} для ${id}`);
  const dir = join('sources', id);
  console.log(id);
  await download(gltf.url, join(dir, `${id}_${RES}.gltf`));
  for (const [rel, f] of Object.entries(gltf.include ?? {})) {
    await download(f.url, join(dir, rel));
  }
}
console.log('Готово.');
