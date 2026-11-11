// Тестовые модели для проверки админки, в т.ч. специально «сломанные».
// Результат — в test-assets/ (в git не попадает). Запуск: node scripts/make-test-assets.mjs
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMaterialsVariants } from '@gltf-transform/extensions';
import { meshopt, textureCompress, prune } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import * as THREE from 'three';
import { mkdir, writeFile, access } from 'node:fs/promises';

await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
await mkdir('test-assets', { recursive: true });
const out = (n) => `test-assets/${n}`;
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

function wrapRoot(doc, { scale = 1, translate = [0, 0, 0], rotX = 0 } = {}) {
  const scene = doc.getRoot().listScenes()[0];
  const w = doc.createNode('wrap').setScale([scale, scale, scale]).setTranslation(translate)
    .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rotX).toArray());
  for (const c of [...scene.listChildren()]) { scene.removeChild(c); w.addChild(c); }
  scene.addChild(w);
}

// 1. Кресло в сантиметрах (×100).
{ const d = await io.read('models/chair/emerald.glb'); wrapRoot(d, { scale: 100 }); await io.write(out('chair-in-cm.glb'), d); }
// 2. Торшер в миллиметрах и «висит» над полом на 30 см.
{ const d = await io.read('models/floor-lamp/sand.glb'); wrapRoot(d, { scale: 1000, translate: [0, 300, 0] }); await io.write(out('floor-lamp-mm-lifted.glb'), d); }
// 3. Стол со сжатием meshopt (Scene Viewer такое не откроет).
{ const d = await io.read('models/coffee-table/white-stone.glb'); await d.transform(meshopt({ encoder: MeshoptEncoder })); await io.write(out('table-meshopt.glb'), d); }
// 4. Кресло с WebP-текстурами.
{ const d = await io.read('models/chair/graphite.glb'); await d.transform(textureCompress({ encoder: sharp, targetFormat: 'webp' })); await io.write(out('chair-webp.glb'), d); }
// 5. Тяжёлая модель «на боку» (Z вверх), ~250 тыс. треугольников, с анимацией.
{
  const { Document } = await import('@gltf-transform/core');
  const d = new Document(); const buf = d.createBuffer();
  const g = new THREE.SphereGeometry(0.45, 420, 300).scale(1, 0.6, 1).translate(0, 0.27, 0);
  const acc = (t, a) => d.createAccessor().setType(t).setArray(a).setBuffer(buf);
  const prim = d.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', new Float32Array(g.attributes.position.array)))
    .setAttribute('NORMAL', acc('VEC3', new Float32Array(g.attributes.normal.array)))
    .setIndices(acc('SCALAR', new Uint32Array(g.index.array)))
    .setMaterial(d.createMaterial('pouf').setBaseColorFactor([0.5, 0.2, 0.1, 1]).setRoughnessFactor(0.8));
  const node = d.createNode('pouf').setMesh(d.createMesh('pouf').addPrimitive(prim))
    .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2).toArray());
  d.createScene('s').addChild(node);
  const times = acc('SCALAR', new Float32Array([0, 1])), vals = acc('VEC3', new Float32Array([1, 1, 1, 1.1, 1.1, 1.1]));
  const sampler = d.createAnimationSampler().setInput(times).setOutput(vals).setInterpolation('LINEAR');
  d.createAnimation('pulse').addSampler(sampler).addChannel(d.createAnimationChannel().setTargetNode(node).setTargetPath('scale').setSampler(sampler));
  await io.write(out('pouf-zup-250k-anim.glb'), d);
}
// 6. Один файл с вариантами KHR_materials_variants: торшер, 3 цвета абажура.
{
  const d = await io.read('models/floor-lamp/white-linen.glb');
  const ext = d.createExtension(KHRMaterialsVariants);
  const shadeMat = d.getRoot().listMaterials().find((m) => m.getName() === 'Shade');
  const prim = d.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).find((p) => p.getMaterial() === shadeMat);
  const list = ext.createMappingList();
  for (const [name, rgb] of [['linen-white', [0.78, 0.74, 0.66]], ['terracotta', [0.48, 0.14, 0.07]], ['navy', [0.03, 0.06, 0.16]]]) {
    const v = ext.createVariant(name);
    const m = shadeMat.clone().setName(`Shade-${name}`).setBaseColorFactor([...rgb, 1]);
    list.addMapping(ext.createMapping().setMaterial(m).addVariant(v));
  }
  prim.setExtension('KHR_materials_variants', list);
  await io.write(out('floor-lamp-variants.glb'), d);
}
// 7. Настенное зеркало Poly Haven (CC0) — для категории «На стену».
if (!(await exists('test-assets/src/mirror.gltf'))) {
  // Node fetch может не ходить через системный прокси — тогда скачайте файлы curl'ом (см. README).
  const files = await (await fetch('https://api.polyhaven.com/files/ornate_mirror_01', { headers: { 'User-Agent': 'ar-primerka-test' } })).json();
  const g = files.gltf['1k'].gltf;
  await mkdir('test-assets/src/textures', { recursive: true });
  const dl = async (url, p) => writeFile(p, Buffer.from(await (await fetch(url, { headers: { 'User-Agent': 'ar-primerka-test' } })).arrayBuffer()));
  await dl(g.url, 'test-assets/src/mirror.gltf');
  for (const [rel, f] of Object.entries(g.include)) { await mkdir(`test-assets/src/${rel.split('/').slice(0, -1).join('/')}`, { recursive: true }); await dl(f.url, `test-assets/src/${rel}`); }
}
{
  const d = await io.read('test-assets/src/mirror.gltf');
  await d.transform(prune());
  await io.write(out('ornate-mirror.glb'), d);
}
console.log('test-assets готовы');
