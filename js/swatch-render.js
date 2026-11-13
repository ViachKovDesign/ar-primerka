// Цвет кружка «как на экране»: каждый вариант рендерится в <model-viewer> при нейтральном свете
// (та же камера и экспозиция, что в окне виджета и на сайте), берётся средний цвет ткани.
//  • Ткань — пиксели, которые меняются от варианта к варианту (ножки, лампочки одинаковые — не входят).
//    Один вариант — материал обивки перекрашивается в контрастный цвет, ткань = изменившиеся пиксели.
//  • Тени и блики отбрасываются по яркости: среднее по пикселям ткани между перцентилями LIT.
// Только браузер (нужен WebGL). Используют админка и tools/swatches.html.
import { linToHex } from './swatch.js';

export const VIEW = {
  'environment-image': 'neutral',
  exposure: '1.05',
  'shadow-intensity': '0',
  'camera-orbit': '-25deg 75deg auto',
  'interaction-prompt': 'none',
  loading: 'eager',
};
export const LIT = [0.4, 0.95];  // доля пикселей ткани по яркости: ниже — тени, выше — блики
const SIZE = 256;
const DIFF = 32;                  // «пиксель другой», 0–255 по любому каналу

const LIN = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });

/**
 * Невидимый <model-viewer> для рендера на запрос (toBlob). Стоит в пределах экрана, но прозрачный и под
 * страницей: элемент за краем экрана model-viewer не перерисовывает после правки материала.
 */
function offscreenViewer() {
  const mv = document.createElement('model-viewer');
  for (const [k, v] of Object.entries(VIEW)) mv.setAttribute(k, v);
  mv.style.cssText = `position:fixed;left:0;top:0;width:${SIZE}px;height:${SIZE}px;opacity:0;pointer-events:none;z-index:-1;`;
  mv.setAttribute('aria-hidden', 'true');
  document.body.append(mv);
  return mv;
}

const LOAD_TIMEOUT = 20000;       // браузер не рисует (вкладка скрыта, нет WebGL) — не ждём вечно

async function load(mv, src) {
  const done = new Promise((ok, fail) => {
    mv.addEventListener('load', ok, { once: true });
    mv.addEventListener('error', (e) => fail(new Error(`модель не загрузилась: ${e.detail?.type ?? ''}`)), { once: true });
    setTimeout(() => fail(new Error('рендер не дождался загрузки модели')), LOAD_TIMEOUT);
  });
  mv.src = src;
  await done;
  mv.cameraOrbit = VIEW['camera-orbit'];
  mv.jumpCameraToGoal();
}

async function pixels(mv) {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const blob = await mv.toBlob({ mimeType: 'image/png', idealAspect: false });
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(SIZE, SIZE);
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0, SIZE, SIZE);
  return ctx.getImageData(0, 0, SIZE, SIZE).data;
}

const differs = (a, b, p) => Math.abs(a[p] - b[p]) > DIFF || Math.abs(a[p + 1] - b[p + 1]) > DIFF || Math.abs(a[p + 2] - b[p + 2]) > DIFF;

/** Средний цвет освещённой ткани: пиксели маски между перцентилями яркости LIT. */
function litColor(img, mask) {
  const px = [];
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p] || img[p * 4 + 3] < 250) continue;
    const r = LIN[img[p * 4]], g = LIN[img[p * 4 + 1]], b = LIN[img[p * 4 + 2]];
    px.push([r, g, b, 0.2126 * r + 0.7152 * g + 0.0722 * b]);
  }
  if (px.length < 30) return null;
  px.sort((a, b) => a[3] - b[3]);
  const part = px.slice(Math.floor(LIT[0] * px.length), Math.ceil(LIT[1] * px.length));
  return linToHex([0, 1, 2].map((k) => part.reduce((s, c) => s + c[k], 0) / part.length));
}

/**
 * Цвета кружков по рендеру.
 * @param {string[]} srcs  адреса GLB (или blob:) вариантов одного товара, в порядке вариантов
 * @param {object} [o]
 * @param {string[]} [o.fabric]  имена материалов обивки — нужны, только если вариант один
 * @returns {Promise<(string|null)[]>} hex на вариант (null — не удалось выделить ткань)
 */
export async function renderSwatches(srcs, { fabric = [] } = {}) {
  await customElements.whenDefined('model-viewer');
  const mv = offscreenViewer();
  try {
    const shots = [];
    for (const src of srcs) { await load(mv, src); shots.push(await pixels(mv)); }
    const n = SIZE * SIZE;
    if (shots.length > 1) {
      // Ткань варианта i — пиксели, где он отличается хотя бы от половины остальных.
      return shots.map((img, i) => {
        const mask = new Uint8Array(n);
        for (let p = 0; p < n; p++) {
          let d = 0;
          for (let j = 0; j < shots.length; j++) if (j !== i && differs(img, shots[j], p * 4)) d++;
          mask[p] = d > 0 && d * 2 >= shots.length - 1 ? 1 : 0;
        }
        return litColor(img, mask);
      });
    }
    // Один вариант: перекрашиваем обивку в контрастный цвет и смотрим, что изменилось.
    const mats = mv.model?.materials.filter((m) => fabric.includes(m.name)) ?? [];
    if (!mats.length) return [litColor(shots[0], new Uint8Array(n).fill(1))];
    for (const m of mats) { m.pbrMetallicRoughness.setBaseColorFactor([0, 0, 0, 1]); m.setEmissiveFactor([1, 0, 1]); }
    const key = await pixels(mv);
    const mask = new Uint8Array(n);
    for (let p = 0; p < n; p++) mask[p] = differs(shots[0], key, p * 4) ? 1 : 0;
    return [litColor(shots[0], mask)];
  } finally {
    mv.remove();
  }
}
