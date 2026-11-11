# Авторы и лицензии

Все сторонние материалы в проекте распространяются под открытыми лицензиями. Платных SDK и ключей нет.

## 3D-модели

| Модель | Автор | Лицензия | Источник | Что изменено |
|---|---|---|---|---|
| Arm Chair 01 (кресло) | Kirill Sannikov, [Poly Haven](https://polyhaven.com) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | https://polyhaven.com/a/ArmChair_01 | Текстуры 1k, упаковка в GLB, ткань перекрашена в 4 варианта, точка опоры перенесена в центр низа |
| Coffee Table Round 01 (журнальный стол) | Ulan Cabanilla, [Poly Haven](https://polyhaven.com) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | https://polyhaven.com/a/coffee_table_round_01 | Текстуры 1k, упаковка в GLB, столешница перекрашена и сделана матовой, вариант с латунными ножками |
| Торшер, настольная лампа | этот проект (собраны кодом из примитивов, `scripts/make-lamps.mjs`) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | — | — |

CC0 не требует указывать авторство, но мы указываем его из уважения к авторам.

## Библиотеки на сайте (лежат в `vendor/`)

| Библиотека | Версия | Автор | Лицензия | Источник |
|---|---|---|---|---|
| `<model-viewer>` | 4.4.0 | Google | Apache-2.0 (`vendor/LICENSE-model-viewer.txt`) | https://github.com/google/model-viewer |
| qrcode-generator | 2.0.4 | Kazuhiko Arase | MIT (`vendor/LICENSE-qrcode-generator.txt`) | https://github.com/kazuhikoarase/qrcode-generator |

`model-viewer.min.js` включает в себя three.js (MIT, https://github.com/mrdoob/three.js).

## Инструменты сборки (только `npm run build`, на сайт не попадают)

| Инструмент | Версия | Лицензия | Источник |
|---|---|---|---|
| three.js | 0.183 | MIT | https://github.com/mrdoob/three.js |
| glTF-Transform | 4.5.1 | MIT | https://github.com/donmccurdy/glTF-Transform |
| sharp | 0.35 | Apache-2.0 | https://github.com/lovell/sharp |
