// Тест цвета кружков.
//  • Кружки в catalog.json = цвет ткани на рендере (tools/swatch-renders.json, js/swatch-render.js).
//    Рендерить в Node нельзя, поэтому замеры лежат в файле вместе с SHA-256 моделей: поменяли модель —
//    тест попросит перемерить (tools/swatches.html).
//  • Запасной расчёт по материалу (js/swatch.js) — на синтетических моделях.
// Запуск: node --test scripts/test-swatch.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Document } from '@gltf-transform/core';
import { KHRMaterialsSheen } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { summarize, swatchesFor, fabricNames, deltaE, hexToLin, linToHex } from '../js/swatch.js';

const decode = async (bytes, mime, n) => sharp(Buffer.from(bytes)).ensureAlpha().resize(n, n, { fit: 'fill' }).raw().toBuffer();
const MAX_DE = 6; // кружок не дальше этого от цвета на рендере (диван «Шампань» был 17)

/** Градиент из двух цветов (кружок «Белый камень, латунь») сравниваем по среднему цвету. */
function swatchColor(swatch) {
  const stops = String(swatch).match(/#[0-9a-f]{6}/gi) ?? [];
  if (!stops.length) return null;
  const lin = stops.map(hexToLin);
  return linToHex([0, 1, 2].map((k) => lin.reduce((s, c) => s + c[k], 0) / lin.length));
}

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url));
const catalog = JSON.parse(read('catalog.json'));
const renders = JSON.parse(read('tools/swatch-renders.json'));

for (const item of catalog.items) {
  test(`кружки = цвет на экране: ${item.id}`, () => {
    const bad = [];
    for (const v of item.variants) {
      const m = renders.items[item.id]?.[v.id];
      if (!m) { bad.push(`${v.id}: нет замера — откройте tools/swatches.html`); continue; }
      const hash = createHash('sha256').update(read(v.model)).digest('hex');
      if (m.model !== v.model || m.sha256 !== hash) { bad.push(`${v.id}: модель изменилась после замера — перемерьте (tools/swatches.html)`); continue; }
      if (m.manual) continue; // кружок оставлен руками, причина записана в замере
      const shown = swatchColor(v.swatch);
      const de = shown ? deltaE(shown, m.render) : Infinity;
      if (de > MAX_DE) bad.push(`${v.id}: в каталоге ${v.swatch}, на экране ${m.render} (ΔE ${de.toFixed(1)})`);
    }
    assert.deepEqual(bad, [], `Поправьте swatch в catalog.json:\n${bad.join('\n')}`);
  });
}

test('ручные кружки — с причиной', () => {
  for (const [id, vs] of Object.entries(renders.items)) for (const [vid, m] of Object.entries(vs)) {
    if ('manual' in m) assert.ok(String(m.manual).length > 10, `${id}/${vid}: укажите, почему кружок оставлен руками`);
  }
});

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

test('запасной расчёт, бархат: светлый ворс поверх тёмной основы делает кружок светлее основы', async () => {
  const dark = hexToLin('#4d4538'), light = hexToLin('#f3dacb');
  const plainLook = await summarize(quadDoc({ base: dark }), decode);
  assert.deepEqual(fabricNames(plainLook), ['fabric'], 'материал обивки для рендера одиночного варианта');
  const [plain] = swatchesFor([plainLook]);
  const [velvet] = swatchesFor([await summarize(quadDoc({ base: dark, sheen: light }), decode)]);
  assert.equal(plain, '#4d4538');
  assert.ok(deltaE(velvet, plain) > 10, `кружок бархата ${velvet} почти как основа ${plain}`);
  // Шероховатый ворс отражает больше: кружок ещё светлее.
  const [rough] = swatchesFor([await summarize(quadDoc({ base: dark, sheen: light, roughness: 1 }), decode)]);
  assert.ok(hexToLin(rough)[1] > hexToLin(velvet)[1]);
});

test('запасной расчёт, обивка в общей текстуре с деревом: в кружок идёт только меняющаяся часть', async () => {
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
