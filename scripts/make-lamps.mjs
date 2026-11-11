// Торшер и настольная лампа из примитивов (тела вращения three.js) → GLB через glTF-Transform.
// Единицы — метры, точка опоры — центр низа. Материалы без текстур: цвет хранится в
// baseColorFactor, который корректно переносится и в Scene Viewer, и в USDZ (Quick Look).
import * as THREE from 'three';
import { Document, NodeIO } from '@gltf-transform/core';
import { dedup, prune } from '@gltf-transform/functions';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const io = new NodeIO();
const V = (x, y) => new THREE.Vector2(x, y);
const SEG = 64;

const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const color = (h) => [1, 3, 5].map((i) => srgbToLin(parseInt(h.slice(i, i + 2), 16) / 255)).concat(1);

/** Тело вращения по профилю [ [r, y], ... ] снизу вверх. */
const lathe = (pts) => new THREE.LatheGeometry(pts.map(([r, y]) => V(r, y)), SEG);
/** То же, но профиль сглажен сплайном (для керамической вазы). */
const smoothLathe = (pts, n = 48) => new THREE.LatheGeometry(new THREE.SplineCurve(pts.map(([r, y]) => V(r, y))).getPoints(n).map((p) => V(Math.max(0, p.x), Math.max(0, p.y))), SEG);

/** Оболочка абажура с толщиной: внешняя поверхность вверх, внутренняя вниз. */
function shadeShell(rBottom, rTop, y0, y1, t = 0.003) {
  return lathe([
    [rBottom - t, y0], [rBottom, y0], [rTop, y1], [rTop - t, y1], [rBottom - t, y0 + 0.0001],
  ]);
}

function addMesh(doc, scene, buffer, name, geometry, material) {
  geometry.computeVertexNormals();
  const g = geometry.index ? geometry : geometry; // LatheGeometry уже индексирована
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', new Float32Array(g.attributes.position.array)))
    .setAttribute('NORMAL', acc('VEC3', new Float32Array(g.attributes.normal.array)))
    .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(g.attributes.uv.array)))
    .setIndices(acc('SCALAR', new Uint16Array(g.index.array)))
    .setMaterial(material);
  const mesh = doc.createMesh(name).addPrimitive(prim);
  scene.addChild(doc.createNode(name).setMesh(mesh));
}

function material(doc, name, hex, { metallic = 0, roughness = 0.6, doubleSided = false, emissive } = {}) {
  const m = doc.createMaterial(name).setBaseColorFactor(color(hex))
    .setMetallicFactor(metallic).setRoughnessFactor(roughness).setDoubleSided(doubleSided);
  if (emissive) m.setEmissiveFactor(color(emissive).slice(0, 3));
  return m;
}

async function writeLamp(file, build) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('Scene');
  doc.getRoot().setDefaultScene(scene);
  build(doc, scene, buffer);
  await doc.transform(dedup(), prune());
  await io.write(file, doc);
  console.log(`  ✓ ${file}`);
}

// ---------- Торшер: Ø45 × 160 см ----------
const FLOOR = [
  { id: 'white-linen', shade: '#e4dccd' },
  { id: 'sand', shade: '#cdb48d' },
  { id: 'sage', shade: '#97a58e' },
  { id: 'black', shade: '#2b2b2d' },
];
await mkdir('models/floor-lamp', { recursive: true });
for (const v of FLOOR) {
  await writeLamp(join('models/floor-lamp', `${v.id}.glb`), (doc, scene, buf) => {
    const metal = material(doc, 'Metal', '#1f1f21', { metallic: 1, roughness: 0.45 });
    const fabricMat = material(doc, 'Shade', v.shade, { roughness: 0.95, doubleSided: true });
    const bulb = material(doc, 'Bulb', '#fff6e0', { roughness: 0.3, emissive: '#ffe9bf' });
    // Основание: диск Ø30 см со скруглённой кромкой.
    addMesh(doc, scene, buf, 'Base', lathe([[0, 0], [0.145, 0], [0.15, 0.006], [0.148, 0.018], [0.03, 0.024], [0, 0.026]]), metal);
    // Стойка Ø2.4 см.
    addMesh(doc, scene, buf, 'Pole', lathe([[0, 0.024], [0.012, 0.024], [0.012, 1.36], [0.016, 1.37], [0.016, 1.40], [0, 1.40]]), metal);
    // Лампочка.
    addMesh(doc, scene, buf, 'Bulb', new THREE.SphereGeometry(0.035, 32, 16).translate(0, 1.43, 0), bulb);
    // Абажур-барабан: низ Ø45, верх Ø38, высота 32 см (1.28–1.60 м).
    addMesh(doc, scene, buf, 'Shade', shadeShell(0.225, 0.19, 1.28, 1.60), fabricMat);
  });
}

// ---------- Настольная лампа: Ø28 × 45 см ----------
const TABLE = [
  { id: 'white', base: '#efece5' },
  { id: 'terracotta', base: '#b8613f' },
  { id: 'sage', base: '#93a38d' },
  { id: 'black', base: '#232326' },
];
await mkdir('models/table-lamp', { recursive: true });
for (const v of TABLE) {
  await writeLamp(join('models/table-lamp', `${v.id}.glb`), (doc, scene, buf) => {
    const ceramic = material(doc, 'Ceramic', v.base, { roughness: 0.32 });
    const brass = material(doc, 'Brass', '#b08a4a', { metallic: 1, roughness: 0.35 });
    const fabricMat = material(doc, 'Shade', '#e6dfd1', { roughness: 0.95, doubleSided: true });
    const bulb = material(doc, 'Bulb', '#fff6e0', { roughness: 0.3, emissive: '#ffe9bf' });
    // Керамическое основание-ваза высотой 24 см.
    addMesh(doc, scene, buf, 'Base', smoothLathe([
      [0, 0], [0.055, 0], [0.062, 0.006], [0.085, 0.05], [0.092, 0.10], [0.082, 0.16],
      [0.05, 0.215], [0.03, 0.235], [0.028, 0.24], [0, 0.242],
    ]), ceramic);
    // Латунный патрон.
    addMesh(doc, scene, buf, 'Socket', lathe([[0, 0.24], [0.014, 0.24], [0.014, 0.29], [0.018, 0.295], [0.018, 0.31], [0, 0.31]]), brass);
    addMesh(doc, scene, buf, 'Bulb', new THREE.SphereGeometry(0.028, 32, 16).translate(0, 0.335, 0), bulb);
    // Абажур: низ Ø28, верх Ø22, высота 20 см (0.25–0.45 м).
    addMesh(doc, scene, buf, 'Shade', shadeShell(0.14, 0.11, 0.25, 0.45), fabricMat);
  });
}
console.log('Готово.');
