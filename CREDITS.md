# Авторы и лицензии

Все сторонние материалы в проекте распространяются под открытыми лицензиями. Платных SDK и ключей нет.

## 3D-модели

| Модель | Автор | Лицензия | Источник | Что изменено |
|---|---|---|---|---|
| Arm Chair 01 (кресло) | Kirill Sannikov, [Poly Haven](https://polyhaven.com) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | https://polyhaven.com/a/ArmChair_01 | Текстуры 1k, упаковка в GLB, ткань перекрашена в 4 варианта, точка опоры перенесена в центр низа |
| Coffee Table Round 01 (журнальный стол) | Ulan Cabanilla, [Poly Haven](https://polyhaven.com) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | https://polyhaven.com/a/coffee_table_round_01 | Текстуры 1k, упаковка в GLB, столешница перекрашена и сделана матовой, вариант с латунными ножками |
| Glam Velvet Sofa (Диван изогнутый) | © Wayfair LLC, из [Khronos glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — **указание автора обязательно** | https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/GlamVelvetSofa | Обработан админкой: варианты обивки нарезаны на 5 отдельных GLB, текстуры перекодированы, точка опоры в центре низа |
| Торшер, настольная лампа | этот проект (собраны кодом из примитивов, `scripts/make-lamps.mjs`) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | — | — |

CC0 не требует указывать авторство, но мы указываем его из уважения к авторам.

## Библиотеки на сайте (лежат в `vendor/`)

| Библиотека | Версия | Автор | Лицензия | Источник |
|---|---|---|---|---|
| `<model-viewer>` | 4.4.0 | Google | Apache-2.0 (`vendor/LICENSE-model-viewer.txt`) | https://github.com/google/model-viewer |
| qrcode-generator | 2.0.4 | Kazuhiko Arase | MIT (`vendor/LICENSE-qrcode-generator.txt`) | https://github.com/kazuhikoarase/qrcode-generator |
| three.js (+ GLTFLoader, RoomEnvironment) | 0.183.2 | three.js authors | MIT (`vendor/LICENSE-three.txt`) | https://github.com/mrdoob/three.js |

Виджет для сайтов магазинов (`widget/engine/`, `npm run widget`) — те же три библиотеки и `js/xr-ar.js`, собранные esbuild в модули, которые грузятся по нажатию; новых зависимостей нет.

`<model-viewer>` подключён модульной сборкой (`model-viewer-module.min.js`), которая использует ту же копию three.js.
Собственный WebXR-режим (`js/xr-ar.js`) основан на официальном примере three.js
[webxr_ar_hittest](https://github.com/mrdoob/three.js/blob/r183/examples/webxr_ar_hittest.html) (MIT).

## Библиотеки админки (`vendor/admin-libs.js`, собраны esbuild из npm-пакетов)

| Библиотека | Версия | Автор | Лицензия | Источник |
|---|---|---|---|---|
| glTF-Transform (core, extensions, functions) | 4.5.1 | Don McCurdy | MIT | https://github.com/donmccurdy/glTF-Transform |
| glTF-Validator | 2.0.0-dev.3.10 | Khronos Group | Apache-2.0 | https://github.com/KhronosGroup/glTF-Validator |
| meshoptimizer (упрощение сетки, распаковка meshopt) | 1.3.0 | Arseny Kapoulkine | MIT | https://github.com/zeux/meshoptimizer |
| fflate (ZIP) | 0.8.3 | Arjun Barrett | MIT | https://github.com/101arrowz/fflate |

## Инструменты сборки (только `npm run build`, на сайт не попадают)

| Инструмент | Версия | Лицензия | Источник |
|---|---|---|---|
| three.js | 0.183 | MIT | https://github.com/mrdoob/three.js |
| glTF-Transform | 4.5.1 | MIT | https://github.com/donmccurdy/glTF-Transform |
| sharp | 0.35 | Apache-2.0 | https://github.com/lovell/sharp |
| gltf-validator (Khronos) | 2.0.0-dev.3.10 | Apache-2.0 | https://github.com/KhronosGroup/glTF-Validator |
| esbuild-wasm | 0.28.2 | MIT | https://github.com/evanw/esbuild |
