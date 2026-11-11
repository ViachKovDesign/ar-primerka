// Каталог читается из catalog.json (его выгружает админка). Здесь — загрузка, проверка полей
// и общие правила по категориям (куда ставить предмет в AR и какие подсказки показывать).

export const CATEGORIES = {
  floor: {
    label: 'На пол',
    arPlacement: 'floor',
    surface: 'полом',
    placed: 'Стоит на полу',
    hint: 'Наведите камеру на пол и медленно поводите телефоном: появится кольцо. Коснитесь экрана — предмет встанет в реальном размере.',
  },
  table: {
    label: 'На стол',
    // У model-viewer «floor» = любая горизонтальная поверхность, в том числе столешница.
    arPlacement: 'floor',
    surface: 'столом',
    placed: 'Стоит на столе',
    hint: 'Наведите камеру на стол и медленно поводите телефоном: на столешнице появится кольцо. Коснитесь экрана — предмет встанет на стол.',
  },
  wall: {
    label: 'На стену',
    arPlacement: 'wall',
    surface: 'стеной',
    placed: 'Висит на стене',
    hint: 'Наведите камеру на стену (лучше с рисунком или предметами рядом) и медленно поводите телефоном: появится кольцо. Коснитесь экрана — предмет повиснет на стене.',
  },
};

// Android: основной режим — собственный WebXR (js/xr-ar.js). Эти ar-modes model-viewer использует,
// только если свой WebXR недоступен или не открылся: его WebXR, затем Scene Viewer. iPhone: Quick Look.
export const AR_MODES = 'webxr scene-viewer quick-look';

// Фон 3D-просмотра и картинки каталога: "dark" — для светлых предметов, "light" — для тёмных.
// Без поля — нейтральный средне-серый.
const BG = new Set(['light', 'dark']);

export async function loadCatalog(url = 'catalog.json') {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`catalog.json: HTTP ${res.status}`);
  const data = await res.json();
  const items = (data.items ?? []).filter((it) => {
    const ok = it.id && it.name && Array.isArray(it.variants) && it.variants.length && it.variants.every((v) => v.id && v.model);
    if (!ok) console.warn('Пропущен товар с неполными данными:', it);
    return ok;
  }).map((it) => ({
    ...it,
    category: CATEGORIES[it.category] ? it.category : 'floor',
    option_label: it.option_label || 'Вариант',
    size_cm: it.size_cm ?? { w: 0, d: 0, h: 0 },
    bg: BG.has(it.bg) ? it.bg : undefined,
    variants: it.variants.map((v) => ({ ...v, bg: BG.has(v.bg) ? v.bg : undefined })),
  }));
  return { currency: data.currency || 'RUB', items };
}

export const modelUrl = (item, variant) => variant.model;
export const posterUrl = (item) => item.poster || '';

export function formatPrice(value, currency = 'RUB') {
  if (value == null || value === '') return '';
  try {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}
