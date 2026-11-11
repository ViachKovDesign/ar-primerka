// Тесты исправлений админки (node --test). Запуск: npm test
// Проверяем, что обработка не добавляет ошибок валидатора Khronos — в первую очередь из-за второго набора UV
// (KHR_texture_transform.texCoord = 1, как в SheenChair из Khronos glTF-Sample-Assets).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureTransform } from '@gltf-transform/extensions';
import { dedup, prune } from '@gltf-transform/functions';
import { validateBytes } from 'gltf-validator';
import { reduceUvSets, syncTransformTexCoords, countUvSets, stripExtensionFromGlb, readGlbJson } from '../js/gltf-fixes.js';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const quiet = { debug() {}, info() {}, warn() {}, error() {} };

// PNG 1×1 — содержимое текстуры не важно.
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));

/** Квадрат из двух треугольников; материал «metal» — только AO на TEXCOORD_1 через KHR_texture_transform. */
function makeDoc({ uv1SameAsUv0 }) {
  const doc = new Document();
  doc.setLogger(quiet);
  const buf = doc.createBuffer();
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
  const uv0 = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const uv1 = uv1SameAsUv0 ? new Float32Array(uv0) : new Float32Array([0.5, 0.5, 0.9, 0.5, 0.9, 0.9, 0.5, 0.9]);
  const tex = doc.createTexture('ao').setImage(PNG).setMimeType('image/png');
  const tt = doc.createExtension(KHRTextureTransform).setRequired(true);
  const mat = doc.createMaterial('metal').setOcclusionTexture(tex);
  mat.getOcclusionTextureInfo().setTexCoord(1).setExtension('KHR_texture_transform', tt.createTransform().setTexCoord(1));
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])))
    .setAttribute('NORMAL', acc('VEC3', new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1])))
    .setAttribute('TEXCOORD_0', acc('VEC2', uv0))
    .setAttribute('TEXCOORD_1', acc('VEC2', uv1))
    .setIndices(acc('SCALAR', new Uint16Array([0, 1, 2, 0, 2, 3])))
    .setMaterial(mat);
  const node = doc.createNode('quad').setMesh(doc.createMesh('quad').addPrimitive(prim));
  doc.createScene('scene').addChild(node);
  return doc;
}

/** Тот же порядок, что в js/admin.js (applyFixes): UV → dedup/prune → страховка texCoord. */
async function processLikeAdmin(doc, { uv = true } = {}) {
  doc.setLogger(quiet);
  const warnings = uv ? reduceUvSets(doc) : [];
  await doc.transform(dedup(), prune({ keepAttributes: true }));
  syncTransformTexCoords(doc);
  return warnings;
}

async function errorsOf(doc) {
  const report = await validateBytes(await io.writeBinary(doc), { maxIssues: 100 });
  return report.issues.messages.filter((m) => m.severity === 0).map((m) => `${m.code} ${m.pointer}`);
}

test('исходная синтетическая модель валидна', async () => {
  assert.deepEqual(await errorsOf(makeDoc({ uv1SameAsUv0: false })), []);
});

test('воспроизведение: один prune() ломает KHR_texture_transform.texCoord (баг glTF-Transform)', async () => {
  const doc = makeDoc({ uv1SameAsUv0: false });
  await doc.transform(prune());
  const errs = await errorsOf(doc);
  assert.ok(errs.some((e) => e.startsWith('MESH_PRIMITIVE_TOO_FEW_TEXCOORDS')), errs.join('\n'));
});

test('страховка после prune(): texCoord в KHR_texture_transform выравнивается', async () => {
  const doc = makeDoc({ uv1SameAsUv0: false });
  await doc.transform(prune());
  assert.equal(syncTransformTexCoords(doc), 1);
  assert.deepEqual(await errorsOf(doc), []);
});

test('TEXCOORD_1 совпадает с TEXCOORD_0 → текстура переводится на 0, без предупреждений', async () => {
  const doc = makeDoc({ uv1SameAsUv0: true });
  const warnings = await processLikeAdmin(doc);
  assert.deepEqual(warnings, []);
  const info = doc.getRoot().listMaterials()[0].getOcclusionTextureInfo();
  assert.ok(doc.getRoot().listMaterials()[0].getOcclusionTexture(), 'AO осталась');
  assert.equal(info.getTexCoord(), 0);
  assert.equal(info.getExtension('KHR_texture_transform').getTexCoord(), 0);
  assert.equal(countUvSets(doc), 1);
  assert.deepEqual(await errorsOf(doc), []);
});

test('TEXCOORD_1 другая развёртка → AO убрана с предупреждением, ошибок нет', async () => {
  const doc = makeDoc({ uv1SameAsUv0: false });
  const warnings = await processLikeAdmin(doc);
  assert.deepEqual(warnings, [{ material: 'metal', slot: 'occlusionTexture', texCoord: 1 }]);
  assert.equal(doc.getRoot().listMaterials()[0].getOcclusionTexture(), null);
  assert.equal(countUvSets(doc), 1);
  assert.deepEqual(await errorsOf(doc), []);
});

test('шаг UV выключен → второй набор UV сохраняется, ошибок нет', async () => {
  const doc = makeDoc({ uv1SameAsUv0: false });
  await processLikeAdmin(doc, { uv: false });
  assert.equal(countUvSets(doc), 2);
  assert.deepEqual(await errorsOf(doc), []);
});

test('stripExtensionFromGlb убирает расширение и файл остаётся валидным', async () => {
  const bytes = await io.writeBinary(makeDoc({ uv1SameAsUv0: true }));
  const out = stripExtensionFromGlb(bytes, 'KHR_texture_transform');
  const json = readGlbJson(out);
  assert.equal(json.extensionsUsed, undefined);
  assert.equal(json.extensionsRequired, undefined);
  assert.ok(!JSON.stringify(json).includes('KHR_texture_transform'));
  const report = await validateBytes(out, { maxIssues: 100 });
  assert.equal(report.issues.numErrors, 0);
});

const SHEEN = new URL('../test-assets/khronos/SheenChair.glb', import.meta.url);
test('SheenChair (Khronos): после обработки ошибок не больше, чем в исходнике (0)', { skip: !existsSync(SHEEN) && 'нет test-assets/khronos/SheenChair.glb' }, async () => {
  const bytes = new Uint8Array(readFileSync(SHEEN));
  const src = await validateBytes(bytes, { maxIssues: 100 });
  assert.equal(src.issues.numErrors, 0);
  const doc = await io.readBinary(bytes);
  const warnings = await processLikeAdmin(doc);
  const errs = await errorsOf(doc);
  assert.deepEqual(errs, []);
  assert.equal(countUvSets(doc), 1);
  console.log(`  SheenChair: предупреждений UV ${warnings.length} — ${warnings.map((w) => `${w.material}/${w.slot}`).join(', ') || 'нет'}`);
});
