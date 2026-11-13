// Тон фона витрины под предмет (поле "bg" в catalog.json).
// Считаем, какая доля видимой поверхности модели светлая: площадь треугольников (в мировых
// координатах) × яркость базового цвета материала (цвет × средний цвет текстуры, линейно).
//   почти всё светлое → "dark"  (светлый предмет на тёмно-сером фоне)
//   почти всё тёмное  → "light" (тёмный предмет на светлом фоне)
//   смешанное         → "mid"   (нейтральный средне-серый фон)
// Модуль без импортов: работает с документом glTF-Transform и в браузере (админка), и в Node (тесты).

export const BG_RULES = { lumThreshold: 0.18, lightShare: 0.75, darkShare: 0.25 };

const SRGB_TO_LIN = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/** Средний линейный цвет RGBA-пикселей (sRGB, 8 бит). */
export function averageLinear(rgba) {
  const acc = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 8) continue; // прозрачные пиксели не считаем
    acc[0] += SRGB_TO_LIN[rgba[i]]; acc[1] += SRGB_TO_LIN[rgba[i + 1]]; acc[2] += SRGB_TO_LIN[rgba[i + 2]];
    n++;
  }
  return n ? acc.map((v) => v / n) : [1, 1, 1];
}

const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * @param doc   документ glTF-Transform
 * @param avgTextureColor async (bytes, mime) => [r, g, b] — средний линейный цвет картинки
 * @returns {{ bg: 'light'|'dark'|'mid', lightShare: number, meanLum: number }}
 */
export async function guessShowcaseBg(doc, avgTextureColor, rules = BG_RULES) {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const areaByMaterial = new Map();
  const nodes = [];
  scene?.traverse((n) => { if (n.getMesh()) nodes.push(n); });
  for (const node of nodes) {
    const m = node.getWorldMatrix();
    for (const prim of node.getMesh().listPrimitives()) {
      const mat = prim.getMaterial();
      if (!mat || (prim.getMode() !== 4)) continue;
      const area = primitiveArea(prim, m);
      areaByMaterial.set(mat, (areaByMaterial.get(mat) ?? 0) + area);
    }
  }
  const texCache = new Map();
  let total = 0, light = 0, lumSum = 0;
  for (const [mat, area] of areaByMaterial) {
    if (!(area > 0)) continue;
    const f = mat.getBaseColorFactor();
    let rgb = f.slice(0, 3);
    const tex = mat.getBaseColorTexture();
    if (tex?.getImage()) {
      if (!texCache.has(tex)) {
        let avg = [1, 1, 1];
        try { avg = await avgTextureColor(tex.getImage(), tex.getMimeType()); } catch { /* не декодируется — только цвет */ }
        texCache.set(tex, avg);
      }
      rgb = rgb.map((c, i) => c * texCache.get(tex)[i]);
    }
    const lum = luminance(rgb);
    total += area; lumSum += lum * area;
    if (lum > rules.lumThreshold) light += area;
  }
  if (!total) return { bg: 'mid', lightShare: 0, meanLum: 0 };
  const lightShare = light / total;
  const bg = lightShare >= rules.lightShare ? 'dark' : lightShare <= rules.darkShare ? 'light' : 'mid';
  return { bg, lightShare, meanLum: lumSum / total };
}

/** Площадь треугольников примитива после матрицы узла (4×4, column-major). */
export function primitiveArea(prim, m) {
  const pos = prim.getAttribute('POSITION');
  if (!pos) return 0;
  const count = pos.getCount();
  const p = new Float32Array(count * 3);
  const v = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    pos.getElement(i, v);
    p[i * 3] = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
    p[i * 3 + 1] = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
    p[i * 3 + 2] = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
  }
  const idx = prim.getIndices();
  const n = idx ? idx.getCount() : count;
  let area = 0;
  for (let t = 0; t + 2 < n; t += 3) {
    const a = (idx ? idx.getScalar(t) : t) * 3, b = (idx ? idx.getScalar(t + 1) : t + 1) * 3, c = (idx ? idx.getScalar(t + 2) : t + 2) * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    area += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
  }
  return area;
}
