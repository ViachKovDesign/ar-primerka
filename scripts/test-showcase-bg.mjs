// Тест автоподбора фона витрины (js/showcase-bg.js) на моделях каталога.
// Запуск: node --test scripts/test-showcase-bg.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { guessShowcaseBg, averageLinear } from '../js/showcase-bg.js';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const avg = async (bytes) => {
  const { data } = await sharp(Buffer.from(bytes)).resize(16, 16, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return averageLinear(data);
};
const bgOf = async (path) => guessShowcaseBg(await io.read(path), avg);

// Ожидания — значения из catalog.json (проставлены вручную после просмотра).
// Тест следит, чтобы автоподбор админки совпадал с ручной разметкой текущего каталога.
const catalog = JSON.parse(await readFile('catalog.json', 'utf8'));
for (const item of catalog.items) {
  for (const v of item.variants) {
    test(`${v.model} → ${v.bg}`, async () => {
      const r = await bgOf(v.model);
      assert.equal(r.bg, v.bg, `доля светлого ${r.lightShare.toFixed(2)}, средняя яркость ${r.meanLum.toFixed(3)}`);
    });
  }
  test(`${item.id}: фон карточки = фон первого варианта`, () => assert.equal(item.bg, item.variants[0].bg));
}

test('пустая модель — средний фон', async () => {
  const doc = new Document();
  doc.createScene('s');
  assert.equal((await guessShowcaseBg(doc, avg)).bg, 'mid');
});

test('SheenChair (если скачан в test-assets/khronos) — решение без ошибок', async (t) => {
  const p = 'test-assets/khronos/SheenChair.glb';
  try { await access(p); } catch { t.skip('нет файла'); return; }
  const r = await guessShowcaseBg(await io.readBinary(new Uint8Array(await readFile(p))), avg);
  t.diagnostic(`SheenChair: bg=${r.bg}, доля светлого ${r.lightShare.toFixed(2)}`);
  assert.ok(r.lightShare >= 0 && r.lightShare <= 1);
});
