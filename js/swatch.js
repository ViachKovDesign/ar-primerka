// Цвет кружка варианта (поле "swatch" в catalog.json) — из самой модели.
//
// Кружок = видимый цвет обивки/отделки, которая меняется от варианта к варианту:
//  1. «Обивка» — места модели (меш × примитив), где материал различается между вариантами.
//     Ножки, лампочки и прочее одинаковое в расчёт не идёт. Один вариант — основной материал
//     (переданный prefer или самый большой по площади).
//  2. Если обивка лежит в одной текстуре с деревом/металлом (кресло Poly Haven), берутся только
//     пиксели текстуры, которые у этого варианта отличаются от остальных.
//  3. Цвет = средний линейный baseColor (текстура × фактор), взвешенный по площади поверхности,
//     + вклад ворса KHR_materials_sheen. Бархат почти весь свой цвет получает от sheen: у дивана
//     «Шампань» baseColor тёмно-оливковый (#4d4538), а на экране он серо-бежевый.
//     Вклад ворса = SHEEN_GAIN × sheenRoughness × sheenColor — подобран по рендерам model-viewer
//     пяти обивок дивана (см. REPORT.md): шероховатый ворс отражает больше света.
// Работает с документом glTF-Transform и в браузере (админка), и в Node (тесты).
import { primitiveArea } from './showcase-bg.js';

export const SHEEN_GAIN = 0.22;
const TEX = 48;          // до такого размера уменьшаем текстуры: для среднего цвета хватает
const PIX_DIFF = 12;     // отличие пикселя между вариантами, 0–255 по любому каналу
const FACTOR_DIFF = 0.01;

const LIN = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const toSrgb8 = (c) => {
  c = Math.min(1, Math.max(0, c));
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
};
export const linToHex = (rgb) => `#${rgb.map((c) => toSrgb8(c).toString(16).padStart(2, '0')).join('')}`;
export function hexToLin(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => LIN[v]);
}

/**
 * Сводка материалов документа по местам модели.
 * @param doc     документ glTF-Transform (до правок, которые меняют материалы)
 * @param decode  async (bytes, mime, size) => RGBA Uint8 (size×size, sRGB)
 * @param prefer  Set материалов — «основной» материал для одиночного варианта (необязательно)
 * @returns {{ slots: Array<{ key, area, preferred, mat }> }}
 */
export async function summarize(doc, decode, prefer = null) {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const meshIndex = new Map(root.listMeshes().map((m, i) => [m, i]));
  const slots = new Map();
  const mats = new Map();
  const nodes = [];
  scene?.traverse((n) => { if (n.getMesh()) nodes.push(n); });
  for (const node of nodes) {
    const mesh = node.getMesh();
    const wm = node.getWorldMatrix();
    for (const [pi, prim] of mesh.listPrimitives().entries()) {
      const mat = prim.getMaterial();
      if (!mat || prim.getMode() !== 4) continue;
      const key = `${meshIndex.get(mesh)}:${pi}`;
      const area = primitiveArea(prim, wm);
      if (!mats.has(mat)) mats.set(mat, await materialSummary(mat, decode));
      const s = slots.get(key) ?? { key, area: 0, preferred: Boolean(prefer?.has(mat)), mat: mats.get(mat) };
      s.area += area;
      slots.set(key, s);
    }
  }
  return { slots: [...slots.values()].filter((s) => s.area > 0) };
}

async function texture(tex, decode) {
  if (!tex?.getImage()) return null;
  try { return await decode(tex.getImage(), tex.getMimeType(), TEX); } catch { return null; }
}

async function materialSummary(mat, decode) {
  const sheen = mat.getExtension?.('KHR_materials_sheen') ?? null;
  return {
    factor: mat.getBaseColorFactor().slice(0, 3),
    tex: await texture(mat.getBaseColorTexture(), decode),
    sheen: sheen ? {
      factor: sheen.getSheenColorFactor().slice(0, 3),
      roughness: sheen.getSheenRoughnessFactor(),
      tex: await texture(sheen.getSheenColorTexture(), decode),
    } : null,
  };
}

/** Средний линейный цвет RGBA-картинки по маске (null — все непрозрачные пиксели). */
function texAvg(data, mask) {
  const acc = [0, 0, 0];
  let n = 0;
  for (let p = 0; p < data.length / 4; p++) {
    if (mask && !mask[p]) continue;
    if (data[p * 4 + 3] < 8) continue;
    acc[0] += LIN[data[p * 4]]; acc[1] += LIN[data[p * 4 + 1]]; acc[2] += LIN[data[p * 4 + 2]];
    n++;
  }
  return n ? acc.map((v) => v / n) : null;
}

/** Видимый цвет материала (линейный): baseColor + вклад ворса. */
export function materialColor(m, mask = null) {
  const t = m.tex ? texAvg(m.tex, mask) ?? texAvg(m.tex, null) : null;
  const base = m.factor.map((f, i) => f * (t ? t[i] : 1));
  if (!m.sheen) return base;
  const st = m.sheen.tex ? texAvg(m.sheen.tex, null) : null;
  const sheen = m.sheen.factor.map((f, i) => f * (st ? st[i] : 1));
  const w = SHEEN_GAIN * m.sheen.roughness;
  return base.map((c, i) => c + w * sheen[i]);
}

const sameTex = (a, b) => a === b || (a && b && a.length === b.length && a.every((v, i) => v === b[i]));
function sameLook(a, b) {
  if (a.factor.some((v, i) => Math.abs(v - b.factor[i]) > FACTOR_DIFF)) return false;
  if (!sameTex(a.tex, b.tex)) return false;
  if (Boolean(a.sheen) !== Boolean(b.sheen)) return false;
  if (a.sheen && (a.sheen.factor.some((v, i) => Math.abs(v - b.sheen.factor[i]) > FACTOR_DIFF)
    || Math.abs(a.sheen.roughness - b.sheen.roughness) > FACTOR_DIFF || !sameTex(a.sheen.tex, b.sheen.tex))) return false;
  return true;
}

/** Маска пикселей, где вариант i отличается хотя бы от половины остальных (обивка внутри общей текстуры). */
function variantMask(texs, i) {
  const n = texs.length;
  if (n < 2 || texs.some((t) => !t || t.length !== texs[i].length)) return null;
  const own = texs[i];
  const mask = new Uint8Array(own.length / 4);
  let any = 0;
  for (let p = 0; p < mask.length; p++) {
    let differs = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const o = texs[j];
      if (Math.abs(own[p * 4] - o[p * 4]) > PIX_DIFF || Math.abs(own[p * 4 + 1] - o[p * 4 + 1]) > PIX_DIFF
        || Math.abs(own[p * 4 + 2] - o[p * 4 + 2]) > PIX_DIFF) differs++;
    }
    if (differs * 2 >= n - 1 && differs > 0) { mask[p] = 1; any++; }
  }
  return any ? mask : null;
}

function weighted(parts) {
  const total = parts.reduce((s, p) => s + p.area, 0);
  if (!total) return [0.8, 0.8, 0.8];
  return [0, 1, 2].map((k) => parts.reduce((s, p) => s + p.area * p.rgb[k], 0) / total);
}

/**
 * Цвета кружков для набора вариантов одного товара.
 * @param {Array<{slots}>} list — summarize() каждого варианта (в одном порядке с вариантами)
 * @returns {string[]} hex на каждый вариант
 */
export function swatchesFor(list) {
  const keys = list[0]?.slots.map((s) => s.key).join('|');
  const sameShape = list.length > 1 && list.every((v) => v.slots.map((s) => s.key).join('|') === keys);
  if (sameShape) {
    const variable = list[0].slots.map((s, si) => si)
      .filter((si) => list.some((v) => !sameLook(v.slots[si].mat, list[0].slots[si].mat)));
    if (variable.length) {
      return list.map((v, i) => linToHex(weighted(variable.map((si) => {
        const mask = variantMask(list.map((x) => x.slots[si].mat.tex), i);
        return { area: v.slots[si].area, rgb: materialColor(v.slots[si].mat, mask) };
      }))));
    }
  }
  return list.map((v) => linToHex(mainColor(v)));
}

/** Один вариант: материал из prefer, иначе самый большой по площади. */
function mainColor({ slots }) {
  let pick = slots.filter((s) => s.preferred);
  if (!pick.length) {
    const byMat = new Map();
    for (const s of slots) byMat.set(s.mat, (byMat.get(s.mat) ?? 0) + s.area);
    const top = [...byMat.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    pick = slots.filter((s) => s.mat === top);
  }
  return weighted(pick.map((s) => ({ area: s.area, rgb: materialColor(s.mat) })));
}

/** Разница цветов ΔE (CIE76, Lab) — для проверки «кружок совпадает с моделью». */
export function deltaE(hexA, hexB) {
  const lab = (lin) => {
    const [r, g, b] = lin;
    const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const a = lab(hexToLin(hexA)), b = lab(hexToLin(hexB));
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
