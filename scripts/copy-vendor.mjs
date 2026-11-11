// Копирует сторонние браузерные библиотеки из node_modules в vendor/ вместе с лицензиями,
// чтобы сайт работал без CDN.
import { copyFile, mkdir, writeFile, readFile } from 'node:fs/promises';

await mkdir('vendor', { recursive: true });
// Модульная сборка без встроенного three.js: three берётся из import map (vendor/three) —
// одна копия three.js и для model-viewer, и для собственного WebXR-режима.
await copyFile('node_modules/@google/model-viewer/dist/model-viewer-module.min.js', 'vendor/model-viewer-module.min.js');
await copyFile('node_modules/@google/model-viewer/LICENSE', 'vendor/LICENSE-model-viewer.txt');
await copyFile('node_modules/qrcode-generator/dist/qrcode.js', 'vendor/qrcode.js');

// three.js — для собственного WebXR-режима (кольцо-указатель + постановка по касанию).
// Структура папок как в пакете, чтобы относительные импорты внутри примеров работали.
const T = 'node_modules/three';
for (const f of [
  'build/three.module.min.js', 'build/three.core.min.js',
  'examples/jsm/loaders/GLTFLoader.js', 'examples/jsm/utils/BufferGeometryUtils.js',
  'examples/jsm/utils/SkeletonUtils.js', 'examples/jsm/environments/RoomEnvironment.js',
]) {
  await mkdir(`vendor/three/${f.split('/').slice(0, -1).join('/')}`, { recursive: true });
  await copyFile(`${T}/${f}`, `vendor/three/${f}`);
}
await copyFile(`${T}/LICENSE`, 'vendor/LICENSE-three.txt');
// В пакете qrcode-generator нет отдельного файла LICENSE — лицензия MIT указана в шапке qrcode.js
// и в package.json; сохраняем её текст рядом.
const pkg = JSON.parse(await readFile('node_modules/qrcode-generator/package.json', 'utf8'));
await writeFile('vendor/LICENSE-qrcode-generator.txt',
`qrcode-generator ${pkg.version} — Copyright (c) 2009 Kazuhiko Arase
https://github.com/kazuhikoarase/qrcode-generator

The MIT License (MIT)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
`);
console.log('vendor/ обновлён');
