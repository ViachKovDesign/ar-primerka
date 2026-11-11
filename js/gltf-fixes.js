// Исправления glTF без зависимостей от браузера: работают с Document из glTF-Transform,
// поэтому их можно проверять тестами в Node (scripts/test-admin.mjs).

/** Человеческие названия слотов текстур — для предупреждений в таблице проверок. */
const SLOT_LABELS = {
  baseColorTexture: 'цвет (baseColor)',
  metallicRoughnessTexture: 'металл/шероховатость',
  normalTexture: 'нормали (normal)',
  occlusionTexture: 'затенение (AO, occlusion)',
  emissiveTexture: 'свечение (emissive)',
};
export const slotLabel = (slot) => SLOT_LABELS[slot] ?? slot;

/**
 * Все слоты текстур материала, включая расширения (sheen, specular, clearcoat…).
 * Возвращает { owner, slot, info }: owner — материал или свойство расширения, slot — имя ссылки
 * (например 'occlusionTexture'), info — TextureInfo со своим texCoord.
 */
export function listTextureSlots(doc, material) {
  const out = [];
  const walk = (owner) => {
    const edges = doc.getGraph().listChildEdges(owner);
    const textures = new Set(edges.filter((e) => e.getChild().propertyType === 'Texture').map((e) => e.getName()));
    for (const e of edges) {
      const child = e.getChild();
      const name = e.getName();
      if (child.propertyType === 'TextureInfo' && name.endsWith('Info') && textures.has(name.slice(0, -4))) {
        out.push({ owner, slot: name.slice(0, -4), info: child });
      } else if (typeof child.extensionName === 'string' && child.propertyType !== 'TextureInfo' && owner === material) {
        walk(child); // свойства расширений материала: KHR_materials_sheen и т. п.
      }
    }
  };
  walk(material);
  return out;
}

/** Набор UV, который реально читает текстура: KHR_texture_transform.texCoord важнее textureInfo.texCoord. */
export function effectiveTexCoord(info) {
  const t = info.getExtension('KHR_texture_transform');
  const o = t?.getTexCoord();
  return o ?? info.getTexCoord();
}

function setTexCoord(info, n) {
  info.setTexCoord(n);
  const t = info.getExtension('KHR_texture_transform');
  if (t && t.getTexCoord() != null) t.setTexCoord(n);
}

/** Примитивы, у которых этот материал — основной или в KHR_materials_variants. */
function primitivesUsing(material) {
  const prims = new Set();
  let level = [material];
  for (let depth = 0; depth < 3 && level.length; depth++) {
    const next = [];
    for (const p of level) for (const parent of p.listParents()) {
      if (parent.propertyType === 'Primitive') prims.add(parent);
      else if (parent.propertyType !== 'Root') next.push(parent);
    }
    level = next;
  }
  return [...prims];
}

function sameAccessor(a, b, eps = 1e-5) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.getCount() !== b.getCount() || a.getElementSize() !== b.getElementSize()) return false;
  const ea = [], eb = [];
  for (let i = 0, n = a.getCount(); i < n; i++) {
    a.getElement(i, ea); b.getElement(i, eb);
    for (let k = 0; k < ea.length; k++) if (Math.abs(ea[k] - eb[k]) > eps) return false;
  }
  return true;
}

/**
 * Сводит UV к одному набору (TEXCOORD_0).
 * - Текстура на TEXCOORD_n (n ≥ 1), если эта развёртка совпадает с первой на всех примитивах материала, —
 *   переводится на 0 (и textureInfo.texCoord, и KHR_texture_transform.texCoord).
 * - Если не совпадает — текстура на первую развёртку не ляжет, слот убирается (обычно это AO) с предупреждением.
 * - Потом TEXCOORD_1+ удаляются со всех примитивов.
 * Возвращает список предупреждений { material, slot, texCoord }.
 */
export function reduceUvSets(doc) {
  const root = doc.getRoot();
  const warnings = [];
  for (const material of root.listMaterials()) {
    const prims = primitivesUsing(material);
    for (const { owner, slot, info } of listTextureSlots(doc, material)) {
      const n = effectiveTexCoord(info);
      if (!n && !info.getTexCoord()) continue;
      const fits = prims.every((p) => sameAccessor(p.getAttribute('TEXCOORD_0'), p.getAttribute(`TEXCOORD_${n}`)));
      if (fits || n === 0) {
        setTexCoord(info, 0);
      } else {
        const setter = `set${slot[0].toUpperCase()}${slot.slice(1)}`;
        owner[setter](null);
        warnings.push({ material: material.getName() || `#${root.listMaterials().indexOf(material)}`, slot, texCoord: n });
      }
    }
  }
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
    for (const target of [prim, ...prim.listTargets()]) {
      for (const s of target.listSemantics()) if (/^TEXCOORD_[1-9]\d*$/.test(s)) target.setAttribute(s, null);
    }
  }
  return warnings;
}

/**
 * Страховка после prune(): glTF-Transform при сдвиге наборов UV меняет textureInfo.texCoord,
 * но не KHR_texture_transform.texCoord. Выравниваем: переопределение не должно указывать на отсутствующий набор.
 */
export function syncTransformTexCoords(doc) {
  let fixed = 0;
  const root = doc.getRoot();
  for (const material of root.listMaterials()) {
    const prims = primitivesUsing(material);
    for (const { info } of listTextureSlots(doc, material)) {
      const t = info.getExtension('KHR_texture_transform');
      const o = t?.getTexCoord();
      if (o == null || o === info.getTexCoord()) continue;
      if (prims.some((p) => !p.getAttribute(`TEXCOORD_${o}`))) { t.setTexCoord(info.getTexCoord()); fixed++; }
    }
  }
  return fixed;
}

/** Наибольшее число наборов UV на примитиве. */
export function countUvSets(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    n = Math.max(n, p.listSemantics().filter((s) => s.startsWith('TEXCOORD_')).length);
  }
  return n;
}

// ---------- Работа с JSON внутри GLB (без glTF-Transform) ----------

/** Читает JSON-часть GLB. */
export function readGlbJson(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('это не GLB');
  const len = dv.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len)));
}

/** Убирает расширение из GLB: из extensionsUsed/Required и из всех объектов `extensions`. Бинарная часть не меняется. */
export function stripExtensionFromGlb(bytes, name) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLen = dv.getUint32(12, true);
  const json = readGlbJson(bytes);
  const walk = (o) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== 'object') return;
    if (o.extensions && typeof o.extensions === 'object') {
      delete o.extensions[name];
      if (!Object.keys(o.extensions).length) delete o.extensions;
    }
    Object.values(o).forEach(walk);
  };
  walk(json);
  for (const k of ['extensionsUsed', 'extensionsRequired']) {
    if (json[k]) { json[k] = json[k].filter((e) => e !== name); if (!json[k].length) delete json[k]; }
  }
  let text = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (text.length % 4)) % 4;
  const jsonChunk = new Uint8Array(text.length + pad).fill(0x20);
  jsonChunk.set(text);
  const rest = bytes.subarray(20 + jsonLen); // BIN-чанк как есть
  const out = new Uint8Array(20 + jsonChunk.length + rest.length);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, 0x46546c67, true);
  odv.setUint32(4, 2, true);
  odv.setUint32(8, out.length, true);
  odv.setUint32(12, jsonChunk.length, true);
  odv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonChunk, 20);
  out.set(rest, 20 + jsonChunk.length);
  return out;
}
