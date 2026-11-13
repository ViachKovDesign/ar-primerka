// Тест цвета кружков (js/swatch.js): кружок в catalog.json совпадает с цветом варианта в модели.
// Запуск: node --test scripts/test-swatch.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsSheen } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { summarize, swatchesFor, deltaE, hexToLin, linToHex } from '../js/swatch.js';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const decode = async (bytes, mime, n) => sharp(Buffer.from(bytes)).ensureAlpha().resize(n, n, { fit: 'fill' }).raw().toBuffer();
const MAX_DE = 10; // больше — цвет кружка заметно другой (диван «Шампань» был 17)

/** Градиент из двух цветов (кружок «Белый камень, латунь») сравниваем по среднему цвету. */
function swatchColor(swatch) {
  const stops = String(swatch).match(/#[0-9a-f]{6}/gi) ?? [];
  if (!stops.length) return null;
  const lin = stops.map(hexToLin);
  return linToHex([0, 1, 2].map((k) => lin.reduce((s, c) => s + c[k], 0) / lin.length));
}

const catalog = JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url), 'utf8'));
for (const item of catalog.items) {
  test(`кружки совпадают с моделью: ${item.id}`, async () => {
    const list = [];
    for (const v of item.variants) list.push(await summarize(await io.read(v.model), decode));
    const auto = swatchesFor(list);
    const bad = item.variants
      .map((v, i) => ({ v, model: auto[i], shown: swatchColor(v.swatch) }))
      .filter((x) => !x.shown || deltaE(x.shown, x.model) > MAX_DE)
      .map((x) => `${x.v.id}: в каталоге ${x.v.swatch}, в модели ${x.model}${x.shown ? ` (ΔE ${deltaE(x.shown, x.model).toFixed(1)})` : ''}`);
    assert.deepEqual(bad, [], `Поправьте swatch в catalog.json:\n${bad.join('\n')}`);
  });
}

// --- Синтетические модели ---
function quadDoc({ base, sheen, roughness = 0.6, texture } = {}) {
  const doc = new Document();
  const buf = doc.createBuffer();
  const pos = doc.createAccessor().setType('VEC3').setBuffer(buf).setArray(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]));
  const uv = doc.createAccessor().setType('VEC2').setBuffer(buf).setArray(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]));
  const idx = doc.createAccessor().setType('SCALAR').setBuffer(buf).setArray(new Uint16Array([0, 1, 2, 0, 2, 3]));
  const mat = doc.createMaterial('fabric').setBaseColorFactor([...base, 1]);
  if (texture) mat.setBaseColorTexture(doc.createTexture().setImage(texture).setMimeType('image/png'));
  if (sheen) {
    const ext = doc.createExtension(KHRMaterialsSheen);
    mat.setExtension('KHR_materials_sheen', ext.createSheen().setSheenColorFactor(sheen).setSheenRoughnessFactor(roughness));
  }
  const prim = doc.createPrimitive().setAttribute('POSITION', pos).setAttribute('TEXCOORD_0', uv).setIndices(idx).setMaterial(mat);
  doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)));
  return doc;
}

test('бархат: светлый ворс поверх тёмной основы делает кружок светлее основы', async () => {
  const dark = hexToLin('#4d4538'), light = hexToLin('#f3dacb');
  const [plain] = swatchesFor([await summarize(quadDoc({ base: dark }), decode)]);
  const [velvet] = swatchesFor([await summarize(quadDoc({ base: dark, sheen: light }), decode)]);
  assert.equal(plain, '#4d4538');
  assert.ok(deltaE(velvet, plain) > 10, `кружок бархата ${velvet} почти как основа ${plain}`);
  // Шероховатый ворс отражает больше: кружок ещё светлее.
  const [rough] = swatchesFor([await summarize(quadDoc({ base: dark, sheen: light, roughness: 1 }), decode)]);
  assert.ok(hexToLin(rough)[1] > hexToLin(velvet)[1]);
});

test('обивка в общей текстуре с деревом: в кружок идёт только меняющаяся часть', async () => {
  // Левая половина текстуры — «дерево» (одинаковое), правая — «ткань» (своя у каждого варианта).
  const png = (fabric) => {
    const n = 16, d = Buffer.alloc(n * n * 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const c = x < n / 2 ? [60, 35, 20] : fabric;
      d.set([...c, 255], (y * n + x) * 4);
    }
    return sharp(d, { raw: { width: n, height: n, channels: 4 } }).png().toBuffer();
  };
  const fabrics = [[40, 120, 90], [200, 150, 40], [180, 180, 175]];
  const list = [];
  for (const f of fabrics) list.push(await summarize(quadDoc({ base: [1, 1, 1], texture: new Uint8Array(await png(f)) }), decode));
  const sw = swatchesFor(list);
  fabrics.forEach((f, i) => {
    const want = `#${f.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    assert.ok(deltaE(sw[i], want) < 3, `вариант ${i}: ${sw[i]}, ткань ${want}`);
  });
});
