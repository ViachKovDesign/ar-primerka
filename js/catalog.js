// Каталог: предметы, реальные размеры, варианты и файлы моделей.
// Каждый вариант — отдельный GLB с «запечённым» цветом, чтобы цвет сохранялся во всех AR-режимах.
export const CATALOG = [
  {
    id: 'chair',
    name: 'Кресло',
    subtitle: 'Мягкое кресло с резной рамой',
    description: 'Глубокая посадка, широкие подлокотники, рама из тёмного дерева. Обивка — плотная мебельная ткань.',
    size: { w: 85, d: 77, h: 107 },
    placement: 'floor',
    placeHint: 'Наведите камеру на пол — кресло встанет в реальном размере.',
    arModes: 'webxr scene-viewer quick-look',
    optionLabel: 'Обивка',
    variants: [
      { id: 'linen-grey', name: 'Светло-серый лён', swatch: '#bdb7ac' },
      { id: 'graphite', name: 'Графит', swatch: '#4a4c50' },
      { id: 'mustard', name: 'Горчичный', swatch: '#b8892a' },
      { id: 'emerald', name: 'Изумруд', swatch: '#2f6b55' },
    ],
  },
  {
    id: 'coffee-table',
    name: 'Журнальный стол',
    subtitle: 'Круглая каменная столешница',
    description: 'Столешница из камня на гнутых металлических ножках. Подходит к дивану и паре кресел.',
    size: { w: 130, d: 130, h: 49 },
    placement: 'floor',
    placeHint: 'Наведите камеру на пол — стол встанет в реальном размере.',
    arModes: 'webxr scene-viewer quick-look',
    optionLabel: 'Отделка',
    variants: [
      { id: 'white-stone', name: 'Белый камень', swatch: '#e6e4df' },
      { id: 'grey-stone', name: 'Серый камень', swatch: '#9c9a96' },
      { id: 'graphite', name: 'Графит', swatch: '#3b3c3f' },
      { id: 'white-brass', name: 'Белый камень, латунь', swatch: 'linear-gradient(135deg,#e6e4df 50%,#b8893b 50%)' },
    ],
  },
  {
    id: 'floor-lamp',
    name: 'Торшер',
    subtitle: 'Абажур-барабан на тонкой стойке',
    description: 'Стальная стойка и тяжёлое основание, тканевый абажур с мягким рассеянным светом.',
    size: { w: 45, d: 45, h: 160 },
    placement: 'floor',
    placeHint: 'Наведите камеру на пол — торшер встанет в реальном размере.',
    arModes: 'webxr scene-viewer quick-look',
    optionLabel: 'Абажур',
    variants: [
      { id: 'white-linen', name: 'Белый лён', swatch: '#e4dccd' },
      { id: 'sand', name: 'Песочный', swatch: '#cdb48d' },
      { id: 'sage', name: 'Шалфей', swatch: '#97a58e' },
      { id: 'black', name: 'Чёрный', swatch: '#2b2b2d' },
    ],
  },
  {
    id: 'table-lamp',
    name: 'Настольная лампа',
    subtitle: 'Керамическое основание, тканевый абажур',
    description: 'Компактная лампа для тумбы или рабочего стола. Основание из глазурованной керамики, латунный патрон.',
    size: { w: 28, d: 28, h: 45 },
    placement: 'table',
    placeHint: 'Наведите камеру на стол и подождите, пока поверхность распознается, — лампа встанет на столешницу.',
    // На Android первым идёт Scene Viewer: он надёжнее находит поверхности выше пола.
    arModes: 'scene-viewer webxr quick-look',
    optionLabel: 'Основание',
    variants: [
      { id: 'white', name: 'Белая керамика', swatch: '#efece5' },
      { id: 'terracotta', name: 'Терракота', swatch: '#b8613f' },
      { id: 'sage', name: 'Шалфей', swatch: '#93a38d' },
      { id: 'black', name: 'Чёрная', swatch: '#232326' },
    ],
  },
];

export const modelUrl = (item, variant) => `models/${item.id}/${variant.id}.glb`;
export const posterUrl = (item) => `posters/${item.id}.webp`;
