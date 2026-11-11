// Собирает GLB-варианты кресла и журнального стола из исходников Poly Haven (CC0).
//
// Почему отдельный файл на каждый вариант: Scene Viewer (Android) открывает файл по URL
// и не видит правок материалов из JS, а Quick Look (iOS) при генерации USDZ на лету
// не переносит оттенок, умноженный на текстуру. Поэтому цвет «запекается» прямо в текстуру.
//
// Перекраска: по маске (яркость/насыщенность пикселя) выделяется ткань или столешница,
// её цвет заменяется целевым с сохранением яркостного рисунка (фактуры) оригинала.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { center, dedup, prune } from '@gltf-transform/functions';
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/**
 * Перекрашивает пиксели по маске.
 * @param raw   {data, info} — RGB(A) пиксели исходной текстуры
 * @param rules [{ mask(r,g,b,lum,sat) -> 0..1, color: '#rrggbb', contrast }]
 */
function recolor({ data, info }, rules) {
  const ch = info.channels;
  const out = Buffer.from(data);
  for (const rule of rules) {
    // Средняя яркость (в линейном пространстве) замаскированной области — опорная точка.
    let sum = 0, wsum = 0;
    for (let i = 0; i < data.length; i += ch) {
      const r = srgbToLin(data[i] / 255), g = srgbToLin(data[i + 1] / 255), b = srgbToLin(data[i + 2] / 255);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const w = rule.mask(r, g, b, lum, mx > 0 ? (mx - mn) / mx : 0);
      sum += lum * w; wsum += w;
    }
    const ref = sum / Math.max(wsum, 1e-6);
    const target = hex(rule.color).map(srgbToLin);
    const k = rule.contrast ?? 1;
    for (let i = 0; i < data.length; i += ch) {
      const r = srgbToLin(data[i] / 255), g = srgbToLin(data[i + 1] / 255), b = srgbToLin(data[i + 2] / 255);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const w = rule.mask(r, g, b, lum, mx > 0 ? (mx - mn) / mx : 0);
      if (w <= 0) continue;
      // Рисунок ткани/камня: отношение яркости пикселя к средней, с регулировкой контраста.
      const detail = Math.pow(lum / ref, k);
      for (let c = 0; c < 3; c++) {
        const src = [r, g, b][c];
        const dst = Math.min(1, target[c] * detail);
        out[i + c] = Math.round(linToSrgb(src * (1 - w) + dst * w) * 255);
      }
    }
  }
  return out;
}

async function buildModel({ id, src, outDir, variants, armBase }) {
  await mkdir(outDir, { recursive: true });
  for (const v of variants) {
    const doc = await io.read(src);
    const root = doc.getRoot();
    const mat = root.listMaterials()[0];
    const tex = mat.getBaseColorTexture();

    if (v.rules?.length) {
      const raw = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const pixels = recolor(raw, v.rules);
      const jpg = await sharp(pixels, { raw: raw.info }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
      tex.setImage(new Uint8Array(jpg)).setMimeType('image/jpeg');
    }
    const armRules = [...(armBase ?? []), ...(v.arm ?? [])];
    if (armRules.length) {
      // Карта ARM (glTF: G = roughness, B = metalness) правится по маске, построенной по исходному цвету.
      const arm = mat.getMetallicRoughnessTexture();
      const srcTex = (await io.read(src)).getRoot().listMaterials()[0].getBaseColorTexture();
      const diff = await sharp(Buffer.from(srcTex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const a = await sharp(Buffer.from(arm.getImage())).removeAlpha().resize(diff.info.width, diff.info.height).raw().toBuffer({ resolveWithObject: true });
      const d = diff.data, o = Buffer.from(a.data);
      for (let i = 0; i < d.length; i += 3) {
        const r = srgbToLin(d[i] / 255), g = srgbToLin(d[i + 1] / 255), b = srgbToLin(d[i + 2] / 255);
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        for (const rule of armRules) {
          const w = rule.mask(lum);
          if (w <= 0) continue;
          if (rule.roughness != null) o[i + 1] = Math.round(o[i + 1] * (1 - w) + rule.roughness * 255 * w);
          if (rule.metallic != null) o[i + 2] = Math.round(o[i + 2] * (1 - w) + rule.metallic * 255 * w);
        }
      }
      const jpg = await sharp(o, { raw: a.info }).jpeg({ quality: 90 }).toBuffer();
      arm.setImage(new Uint8Array(jpg)).setMimeType('image/jpeg');
    }

    // Реальный размер уже в метрах; ставим точку опоры в центр низа (на пол / на стол).
    await doc.transform(center({ pivot: 'below' }), dedup(), prune());
    const file = join(outDir, `${v.id}.glb`);
    await io.write(file, doc);
    console.log(`  ✓ ${file}`);
  }
}

// ---------- Кресло ----------
// Ткань — светлые малонасыщенные пиксели; рама — тёмное дерево.
const fabric = (r, g, b, lum) => smooth(0.11, 0.19, lum);
await buildModel({
  id: 'chair',
  src: 'sources/ArmChair_01/ArmChair_01_1k.gltf',
  outDir: 'models/chair',
  variants: [
    { id: 'linen-grey', rules: [{ mask: fabric, color: '#a9a399', contrast: 1 }] },
    { id: 'graphite', rules: [{ mask: fabric, color: '#4a4c50', contrast: 0.9 }] },
    { id: 'mustard', rules: [{ mask: fabric, color: '#b8892a', contrast: 1 }] },
    { id: 'emerald', rules: [{ mask: fabric, color: '#2f6b55', contrast: 1 }] },
  ],
});

// ---------- Журнальный стол ----------
// Столешница — светлый камень; ножки — тёмный металл.
const top = (r, g, b, lum) => smooth(0.24, 0.40, lum);
const legs = (lum) => 1 - smooth(0.025, 0.05, lum);
await buildModel({
  id: 'coffee-table',
  src: 'sources/coffee_table_round_01/coffee_table_round_01_1k.gltf',
  outDir: 'models/coffee-table',
  // Столешница матовая (шлифованный камень): без зеркального блика, который «съедал» цвет.
  armBase: [{ mask: (lum) => smooth(0.24, 0.40, lum), roughness: 0.62 }],
  variants: [
    { id: 'white-stone', rules: [{ mask: top, color: '#e6e4df', contrast: 1 }] },
    { id: 'grey-stone', rules: [{ mask: top, color: '#9c9a96', contrast: 1.1 }] },
    { id: 'graphite', rules: [{ mask: top, color: '#3b3c3f', contrast: 1.2 }] },
    {
      id: 'white-brass',
      rules: [
        { mask: top, color: '#e6e4df', contrast: 1 },
        { mask: (r, g, b, lum) => legs(lum), color: '#b8893b', contrast: 0.6 },
      ],
      arm: [{ mask: legs, metallic: 1, roughness: 0.35 }],
    },
  ],
});
console.log('Готово.');
