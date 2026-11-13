// Тест подписи «Автор и лицензия модели» (js/credit.js).
// Запуск: node --test scripts/test-credit.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { detectLicense, hasAuthor, creditWarning, creditFields } from '../js/credit.js';
import { readGlbJson } from '../js/gltf-fixes.js';

test('распознаёт лицензии Creative Commons', () => {
  assert.equal(detectLicense('(c) 2021 Wayfair, CC BY 4.0.').code, 'CC BY 4.0');
  assert.equal(detectLicense('CC-BY-SA-4.0').code, 'CC BY-SA 4.0');
  assert.equal(detectLicense('cc by-nc-nd 3.0').url, 'https://creativecommons.org/licenses/by-nc-nd/3.0/');
  assert.equal(detectLicense('Poly Haven, CC0').attribution, false);
  assert.equal(detectLicense('CC BY').url, null, 'без версии ссылку не угадываем');
  assert.equal(detectLicense('все права защищены'), null);
});

test('автор: есть или нет', () => {
  assert.equal(hasAuthor('«Glam Velvet Sofa» © 2021 Wayfair LLC, CC BY 4.0'), true);
  assert.equal(hasAuthor('Модель: Иван Петров, CC BY-NC 3.0'), true);
  assert.equal(hasAuthor('CC BY 4.0'), false);
  assert.equal(hasAuthor('3D-модель, лицензия CC BY 4.0, https://example.com/x'), false);
  assert.equal(hasAuthor('© 2021, CC BY'), false);
});

test('предупреждение: CC BY без автора', () => {
  assert.match(creditWarning('CC BY 4.0'), /требует указать автора/);
  assert.equal(creditWarning('«Sofa» © Wayfair, CC BY 4.0'), null);
  assert.equal(creditWarning('Poly Haven, CC0'), null, 'CC0 автора не требует');
  assert.equal(creditWarning(''), null, 'поле необязательное');
  assert.match(creditWarning('', '(c) 2021 Wayfair, CC BY 4.0.'), /В файле модели указана лицензия CC BY 4\.0/);
  assert.equal(creditWarning('', '(c) Someone, CC0'), null);
});

test('поля для catalog.json', () => {
  assert.deepEqual(creditFields('  '), {});
  assert.deepEqual(creditFields('X Y, CC BY 4.0'), { credit: 'X Y, CC BY 4.0', credit_license_url: 'https://creativecommons.org/licenses/by/4.0/' });
  assert.deepEqual(creditFields('Студия «Мебель»'), { credit: 'Студия «Мебель»' });
});

test('подписи в catalog.json: у моделей CC BY есть автор', () => {
  const { items } = JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url), 'utf8'));
  for (const it of items.filter((x) => x.credit)) {
    assert.equal(creditWarning(it.credit), null, `${it.id}: ${it.credit}`);
  }
  assert.ok(items.find((x) => x.id === 'divan-izognutyy')?.credit, 'у дивана (CC BY) подпись обязательна');
});

const SOFA = new URL('../test-assets/khronos/GlamVelvetSofa.glb', import.meta.url);
test('copyright из GLB: диван Khronos — CC BY', { skip: !existsSync(SOFA) && 'нет test-assets/khronos/GlamVelvetSofa.glb' }, () => {
  const note = readGlbJson(new Uint8Array(readFileSync(SOFA))).asset.copyright;
  assert.equal(detectLicense(note).code, 'CC BY 4.0');
  assert.equal(hasAuthor(note), true);
  assert.match(creditWarning('', note), /CC BY 4\.0/);
});
