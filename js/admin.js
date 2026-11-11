// Админка каталога (прототип, без сервера). Всё выполняется в браузере:
// чтение GLB → проверка → исправления → нарезка вариантов → превью → ZIP с catalog.json и моделями.
// Основа — glTF-Transform (MIT), валидатор Khronos (Apache-2.0), meshoptimizer (MIT), fflate (MIT),
// собранные в vendor/admin-libs.js (scripts/admin-libs-entry.mjs).
import * as L from '../vendor/admin-libs.js';
import * as THREE from 'three';
import { CATEGORIES, loadCatalog, formatPrice } from './catalog.js';
import { guessShowcaseBg, averageLinear } from './showcase-bg.js';
import { reduceUvSets, syncTransformTexCoords, slotLabel, readGlbJson, stripExtensionFromGlb } from './gltf-fixes.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MB = (n) => `${(n / 1048576).toFixed(n < 1048576 ? 2 : 1)} МБ`;
const cm = (m) => Math.round(m * 1000) / 10; // метры → см с точностью 1 мм

// Пороги — те же, что в MODEL-SPEC.md.
const LIMITS = { warnMB: 10, errMB: 15, tris: 100000, materials: 10, tex: 2048 };
// Правдоподобный наибольший габарит (см) по категории — для подсказки про единицы.
const PLAUSIBLE = { floor: [25, 400], table: [8, 120], wall: [15, 300] };
const HARD = [5, 500]; // меньше 5 см или больше 5 м — точно ошибка масштаба
const FORBIDDEN = {
  KHR_texture_basisu: 'KTX2-текстуры: Scene Viewer их не открывает, а USDZ для iPhone не собирается. Пересохраните модель с JPEG/PNG.',
  KHR_draco_mesh_compression: 'Сжатие Draco: Scene Viewer его не гарантирует. Пересохраните модель без сжатия.',
};
const REMOVABLE = {
  EXT_meshopt_compression: 'Сжатие meshopt — будет распаковано (Scene Viewer его не открывает).',
  KHR_mesh_quantization: 'Квантование вершин — будет распаковано.',
  EXT_texture_webp: 'WebP-текстуры — будут пересохранены в JPEG/PNG.',
};

// ---------- Состояние ----------
const S = {
  catalog: { version: 1, currency: 'RUB', items: [] },
  deleted: new Set(),
  dirty: false,
  sources: [],          // { name, bytes, report, info, variantNames }
  st: { category: 'floor', scale: 1, scaleMode: '1', heightCm: '', rotY: 0, zUp: false, pivot: true, textures: true, simplify: false, simplifyTarget: 90000, stripAnim: true, uv: true, cleanup: true, keepVariants: false },
  blame: null,          // какой шаг обработки добавил ошибки валидатора (см. diagnose)
  checks: null,         // итог таблицы проверок — для причины серой кнопки выгрузки
  stripped: [],         // расширения, убранные по кнопке «Убрать и продолжить»
  variantMode: 'single', // single | ext | files | manual
  rows: [],             // { id, name, swatch, swatchTouched, src } — строки таблицы вариантов
  manual: { material: 0, threshold: 0 },
  built: [],            // { id, name, swatch, bytes, doc, report, url }
  builtInfo: null,
  pv: 0,
  human: false,
  buildSeq: 0,
};

let io;

// ---------- Запуск ----------
async function boot() {
  try {
    await Promise.all([L.MeshoptDecoder.ready, L.MeshoptSimplifier.ready]);
    io = new L.WebIO().registerExtensions(L.ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': L.MeshoptDecoder });
    try {
      const raw = await (await fetch('catalog.json', { cache: 'no-cache' })).json();
      S.catalog = { version: raw.version ?? 1, currency: raw.currency ?? 'RUB', updated: raw.updated, items: raw.items ?? [] };
    } catch (e) {
      status('boot-status', `catalog.json не загрузился (${e.message}) — начнём с пустого каталога.`, 'err');
    }
    renderCatalog();
    if (!$('boot-status').classList.contains('err')) $('boot-status').hidden = true;
    window.__adminReady = true;
    // Файл, брошенный до загрузки инструментов (см. скрипт в конце admin.html).
    if (window.__queuedFiles?.length) loadFiles(window.__queuedFiles.splice(0));
  } catch (e) {
    status('boot-status', `Не удалось загрузить инструменты: ${e.message}`, 'err');
  }
}

function status(id, text, kind = '') {
  const el = $(id);
  el.hidden = !text;
  el.textContent = text ?? '';
  el.className = `admin-status ${kind}`;
}

// =====================================================================
// Каталог: список, правка цены/названия/категории, удаление
// =====================================================================
function renderCatalog() {
  const items = S.catalog.items;
  $('cat-count').textContent = `· ${items.length - S.deleted.size}`;
  $('cat-body').innerHTML = items.map((it, i) => `
    <tr class="${S.deleted.has(it.id) ? 'deleted' : ''}">
      <td>${it.poster ? `<img class="cat-thumb stage-bg"${it.bg && it.bg !== 'mid' ? ` data-bg="${esc(it.bg)}"` : ''} src="${esc(it.poster)}" alt="">` : ''}</td>
      <td><input type="text" data-i="${i}" data-k="name" value="${esc(it.name)}" aria-label="Название"><span class="sub note">${esc(it.id)}</span></td>
      <td><input type="number" class="num" data-i="${i}" data-k="price" value="${it.price ?? ''}" min="0" step="100" aria-label="Цена"></td>
      <td><select data-i="${i}" data-k="category" aria-label="Категория">${Object.entries(CATEGORIES).map(([k, c]) =>
        `<option value="${k}" ${it.category === k ? 'selected' : ''}>${c.label}</option>`).join('')}</select></td>
      <td>${it.variants?.length ?? 0}</td>
      <td><button type="button" class="btn btn-small ${S.deleted.has(it.id) ? '' : 'btn-danger'}" data-del="${i}">${S.deleted.has(it.id) ? 'Вернуть' : 'Удалить'}</button></td>
    </tr>`).join('') || '<tr><td colspan="6" class="note">Каталог пуст.</td></tr>';
  $('cat-download').disabled = !S.dirty;
  $('cat-dirty').hidden = !S.dirty;
  $('cat-deleted-note').textContent = S.deleted.size
    ? ` Модели удалённых товаров останутся в репозитории — удалите папки: ${[...S.deleted].map((id) => `models/${id}/`).join(', ')}.`
    : '';
}

$('cat-body').addEventListener('change', (e) => {
  const t = e.target;
  if (!t.dataset.k) return;
  const it = S.catalog.items[+t.dataset.i];
  it[t.dataset.k] = t.dataset.k === 'price' ? (t.value === '' ? null : Number(t.value)) : t.value;
  S.dirty = true;
  renderCatalog();
});
$('cat-body').addEventListener('click', (e) => {
  const b = e.target.closest('[data-del]');
  if (!b) return;
  const id = S.catalog.items[+b.dataset.del].id;
  if (S.deleted.has(id)) S.deleted.delete(id); else S.deleted.add(id);
  S.dirty = true;
  renderCatalog();
});
$('cat-download').addEventListener('click', () => {
  download(new Blob([JSON.stringify(catalogForExport(), null, 2) + '\n'], { type: 'application/json' }), 'catalog.json');
});

function catalogForExport(extraItem) {
  const items = S.catalog.items.filter((it) => !S.deleted.has(it.id) && it.id !== extraItem?.id);
  if (extraItem) items.push(extraItem);
  return { version: S.catalog.version ?? 1, currency: S.catalog.currency ?? 'RUB', updated: new Date().toISOString().slice(0, 10), items };
}

// =====================================================================
// 1. Загрузка файлов
// =====================================================================
const dz = $('dropzone');
['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
dz.addEventListener('drop', (e) => loadFiles([...e.dataTransfer.files]));
$('file-input').addEventListener('change', (e) => loadFiles([...e.target.files]));

async function loadFiles(files) {
  files = files.filter((f) => /\.glb$/i.test(f.name));
  if (!files.length) { status('load-status', 'Нужен файл .glb (glTF Binary). Если у вас .gltf, .fbx или .obj — экспортируйте в GLB (см. MODEL-SPEC.md).', 'err'); return; }
  files.sort((a, b) => a.name.localeCompare(b.name));
  S.stripped = [];
  await loadSources(await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
}

async function loadSources(list) {
  status('load-status', `Читаем ${list.length > 1 ? `${list.length} файла` : list[0].name}…`, 'busy');
  const sources = [];
  for (const { name, bytes } of list) {
    const src = { name, bytes, report: null, info: null, error: null, variantNames: [], ext: [] };
    try {
      const json = readGlbJson(bytes);
      src.ext = json.extensionsUsed ?? [];
      src.required = json.extensionsRequired ?? [];
    } catch { /* не GLB — скажет чтение ниже */ }
    try {
      src.report = await L.validateBytes(bytes, { maxIssues: 200 });
    } catch (e) { src.error = `Валидатор не смог прочитать файл: ${e.message ?? e}`; }
    try {
      const doc = await io.readBinary(bytes);
      src.info = inspectDoc(doc);
      src.variantNames = src.info.variants;
    } catch (e) {
      console.error(e);
      src.error = /draco/i.test(e.message) ? FORBIDDEN.KHR_draco_mesh_compression
        : /ktx|basis/i.test(e.message) ? FORBIDDEN.KHR_texture_basisu
          : `Файл не читается: ${e.message}`;
      src.fixable = strippable(src, e.message);
    }
    sources.push(src);
  }
  S.sources = sources;
  const bad = sources.find((s) => s.error);
  if (bad) {
    showError('load-status', `${bad.name}: ${bad.error}`, bad.fixable ?? []);
    $('work').hidden = true;
    return;
  }
  status('load-status', `Загружено: ${sources.map((s) => `${s.name} (${MB(s.bytes.byteLength)})`).join(', ')}${S.stripped.length ? `. Убрано расширений: ${S.stripped.join(', ')}` : ''}`, 'ok');
  autoSettings();
  setupVariantMode();
  prefillCard();
  $('work').hidden = false;
  syncControls();
  rebuild();
  $('chk-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Какие расширения можно предложить убрать, если файл не читается или не обрабатывается.
 * Сжатие геометрии/текстур не предлагаем: без него данные не прочитать (для них отдельные сообщения).
 * Если расширение названо в тексте ошибки — предлагаем только его.
 */
function strippable(src, message = '') {
  const all = (src.ext ?? []).filter((e) => !FORBIDDEN[e] && !REMOVABLE[e]);
  const named = all.filter((e) => message.includes(e));
  return named.length ? named : all;
}

/** Сообщение об ошибке + кнопки «Убрать <расширение> и продолжить». */
function showError(id, text, exts) {
  const el = $(id);
  el.hidden = false;
  el.className = 'admin-status err';
  el.innerHTML = `${esc(text)}${exts.length ? `<br>Если не получается из-за расширения glTF, его можно убрать и продолжить (внешний вид может немного измениться):<br>${
    exts.map((e) => `<button type="button" class="btn btn-small" data-strip="${esc(e)}">Убрать ${esc(e)} и продолжить</button>`).join('')}` : ''}`;
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-strip]');
  if (!b || !S.sources.length) return;
  const ext = b.dataset.strip;
  S.stripped.push(ext);
  const list = S.sources.map((s) => ({ name: s.name, bytes: (s.ext ?? []).includes(ext) ? stripExtensionFromGlb(s.bytes, ext) : s.bytes }));
  status('build-status', '');
  await loadSources(list);
});

/** Сводка по документу: габариты, треугольники, текстуры, расширения, варианты. */
function inspectDoc(doc) {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const b = L.getBounds(scene);
  let tris = 0, uvSets = 1;
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices();
    const count = idx ? idx.getCount() : p.getAttribute('POSITION')?.getCount() ?? 0;
    if (p.getMode() === 4) tris += count / 3;
    uvSets = Math.max(uvSets, p.listSemantics().filter((s) => s.startsWith('TEXCOORD_')).length);
  }
  const textures = root.listTextures().map((t) => {
    const size = L.ImageUtils.getSize(t.getImage(), t.getMimeType()) ?? [0, 0];
    return { name: t.getName() || t.getURI(), mime: t.getMimeType(), w: size[0], h: size[1], bytes: t.getImage()?.byteLength ?? 0 };
  });
  const ext = root.listExtensionsUsed().map((e) => e.extensionName);
  const variantsExt = root.listExtensionsUsed().find((e) => e.extensionName === 'KHR_materials_variants');
  return {
    size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]],
    min: b.min, max: b.max,
    tris: Math.round(tris),
    materials: root.listMaterials().length,
    materialList: root.listMaterials().map((m, i) => ({ i, name: m.getName() || `Материал ${i + 1}`, textured: Boolean(m.getBaseColorTexture()), color: m.getBaseColorFactor() })),
    textures,
    maxTex: Math.max(0, ...textures.map((t) => Math.max(t.w, t.h))),
    ext,
    animations: root.listAnimations().length,
    skins: root.listSkins().length,
    uvSets,
    variants: variantsExt ? variantsExt.listVariants().map((v) => v.getName()) : [],
  };
}

/** Начальные настройки: подсказка единиц, упрощение, анимации. */
function autoSettings() {
  const info = S.sources[0].info;
  const st = S.st;
  st.rotY = 0; st.zUp = false; st.heightCm = '';
  st.simplify = info.tris > LIMITS.tris;
  st.simplifyTarget = 90000;
  st.stripAnim = true;
  st.textures = true;
  st.pivot = true;
  st.uv = true;
  st.cleanup = true;
  st.keepVariants = false;
  const sug = suggestScale(Math.max(...info.size), st.category);
  st.scaleMode = String(sug);
  st.scale = sug;
}

function suggestScale(maxDimRaw, category) {
  const [lo, hi] = PLAUSIBLE[category];
  for (const f of [1, 0.01, 0.001, 0.0254]) {
    const c = maxDimRaw * f * 100;
    if (c >= lo && c <= hi) return f;
  }
  return 1;
}

// =====================================================================
// 2. Настройки исправлений
// =====================================================================
function syncControls() {
  const st = S.st;
  document.querySelector(`#category input[value="${st.category}"]`).checked = true;
  $('scale-mode').value = st.scaleMode;
  $('height-wrap').hidden = st.scaleMode !== 'height';
  $('height-cm').value = st.heightCm;
  $('z-up').checked = st.zUp;
  $('fix-pivot').checked = st.pivot;
  $('fix-textures').checked = st.textures;
  $('fix-simplify').checked = st.simplify;
  $('simplify-target').value = st.simplifyTarget;
  $('fix-anim').checked = st.stripAnim;
  $('fix-uv').checked = st.uv;
  $('fix-cleanup').checked = st.cleanup;
  $('pivot-label').textContent = st.category === 'wall'
    ? 'Опора для стены: центр задней плоскости'
    : `Поставить ${st.category === 'table' ? 'на стол' : 'на пол'}: центр низа в точке опоры`;
  const info = S.sources[0]?.info;
  if (info) {
    const raw = Math.max(...info.size);
    const sug = suggestScale(raw, st.category);
    const names = { 1: 'метрах', 0.01: 'сантиметрах', 0.001: 'миллиметрах', 0.0254: 'дюймах' };
    $('scale-note').textContent = sug !== 1
      ? `Похоже, модель в ${names[sug]}: без пересчёта наибольший габарит ${fmtLen(raw)}.`
      : `Наибольший габарит как есть: ${fmtLen(raw)}.`;
    $('scale-note').className = `note ${sug !== 1 ? 'warn' : ''}`;
  }
}

const fmtLen = (m) => (m >= 1 ? `${(m).toFixed(2)} м` : m >= 0.01 ? `${cm(m)} см` : `${(m * 1000).toFixed(1)} мм`);

function readControls() {
  const st = S.st;
  st.category = document.querySelector('#category input:checked').value;
  st.scaleMode = $('scale-mode').value;
  st.heightCm = $('height-cm').value;
  st.zUp = $('z-up').checked;
  const rawH = S.sources[0].info.size[st.zUp ? 2 : 1];
  st.scale = st.scaleMode === 'height'
    ? (Number(st.heightCm) > 0 && rawH > 0 ? Number(st.heightCm) / 100 / rawH : 1)
    : Number(st.scaleMode);
  st.pivot = $('fix-pivot').checked;
  st.textures = $('fix-textures').checked;
  st.simplify = $('fix-simplify').checked;
  st.simplifyTarget = Math.max(5000, Number($('simplify-target').value) || 90000);
  st.stripAnim = $('fix-anim').checked;
  st.uv = $('fix-uv').checked;
  st.cleanup = $('fix-cleanup').checked;
}

let rebuildTimer;
function scheduleRebuild() { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuild, 350); }

for (const id of ['scale-mode', 'height-cm', 'z-up', 'fix-pivot', 'fix-textures', 'fix-simplify', 'simplify-target', 'fix-anim', 'fix-uv', 'fix-cleanup']) {
  $(id).addEventListener('change', () => { readControls(); syncControls(); scheduleRebuild(); });
}
$('height-cm').addEventListener('input', () => { readControls(); scheduleRebuild(); });
$('category').addEventListener('change', () => { readControls(); syncControls(); scheduleRebuild(); });
$('rot-left').addEventListener('click', () => { S.st.rotY = (S.st.rotY + 90) % 360; scheduleRebuild(); });
$('rot-right').addEventListener('click', () => { S.st.rotY = (S.st.rotY + 270) % 360; scheduleRebuild(); });

// =====================================================================
// Обработка: исправления → документ на каждый вариант
// =====================================================================
async function applyFixes(doc, st) {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  for (const s of root.listScenes()) if (s !== scene) s.dispose();
  root.setDefaultScene(scene);

  // Анимации и скелет.
  if (st.stripAnim) {
    root.listAnimations().forEach((a) => a.dispose());
    root.listNodes().forEach((n) => n.getSkin() && n.setSkin(null));
    root.listSkins().forEach((s) => s.dispose());
  }

  // Распаковать то, что Scene Viewer не открывает (данные уже распакованы при чтении).
  if (root.listExtensionsUsed().some((e) => e.extensionName === 'KHR_mesh_quantization')) await doc.transform(L.dequantize());
  for (const e of root.listExtensionsUsed()) {
    if (e.extensionName === 'EXT_meshopt_compression' || e.extensionName === 'KHR_mesh_quantization') e.dispose();
  }

  // Один набор UV. Текстуры второй развёртки переводятся на первую, если развёртки совпадают,
  // иначе убираются с предупреждением (обычно AO). См. js/gltf-fixes.js.
  const uvWarnings = st.uv ? reduceUvSets(doc) : [];

  // Ориентация и масштаб: всё содержимое сцены — под один корневой узел.
  const wrap = doc.createNode('AR_Root');
  for (const child of [...scene.listChildren()]) { scene.removeChild(child); wrap.addChild(child); }
  scene.addChild(wrap);
  const q = new THREE.Quaternion();
  if (st.zUp) q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(st.rotY)));
  wrap.setRotation(q.toArray()).setScale([st.scale, st.scale, st.scale]);

  // Упрощение сетки (без расширений сжатия — файл остаётся обычным GLB).
  if (st.simplify) {
    const tris = inspectDoc(doc).tris;
    if (tris > st.simplifyTarget) {
      await doc.transform(L.weld(), L.simplify({ simplifier: L.MeshoptSimplifier, ratio: st.simplifyTarget / tris, error: 0.01, lockBorder: false }));
    }
  }

  // Текстуры: ≤ 2048 px, только JPEG/PNG.
  if (st.textures) await fixTextures(doc);
  for (const e of root.listExtensionsUsed()) if (e.extensionName === 'EXT_texture_webp') e.dispose();

  // Точка опоры.
  if (st.pivot) {
    const b = L.getBounds(scene);
    const c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    wrap.setTranslation(st.category === 'wall' ? [-c[0], -c[1], -b.min[2]] : [-c[0], -b.min[1], -c[2]]);
  }
  // keepAttributes: наборы UV сводим сами (выше). prune() сдвигает TEXCOORD_n, но не трогает
  // KHR_texture_transform.texCoord — из-за этого SheenChair получал ошибку MESH_PRIMITIVE_TOO_FEW_TEXCOORDS.
  if (st.cleanup) await doc.transform(L.dedup(), L.prune({ keepAttributes: true }));
  syncTransformTexCoords(doc);
  return { uvWarnings };
}

async function fixTextures(doc) {
  const root = doc.getRoot();
  for (const tex of root.listTextures()) {
    const mime = tex.getMimeType();
    if (mime === 'image/ktx2') continue; // отсекается проверкой выше
    const [w, h] = L.ImageUtils.getSize(tex.getImage(), mime) ?? [0, 0];
    const bigPng = mime === 'image/png' && tex.getImage().byteLength > 700 * 1024;
    const needs = Math.max(w, h) > LIMITS.tex || !['image/jpeg', 'image/png'].includes(mime) || bigPng;
    if (!needs) continue;
    const alpha = textureNeedsAlpha(root, tex);
    const s = Math.min(1, LIMITS.tex / Math.max(w, h));
    const { bytes, type } = await reencode(tex.getImage(), mime, Math.round(w * s), Math.round(h * s), alpha ? 'image/png' : 'image/jpeg');
    tex.setImage(bytes).setMimeType(type).setURI('');
  }
}

function textureNeedsAlpha(root, tex) {
  return root.listMaterials().some((m) => m.getBaseColorTexture() === tex && m.getAlphaMode() !== 'OPAQUE');
}

/** Средний линейный цвет текстуры (для автоподбора фона витрины). */
async function avgTextureLinear(bytes, mime) {
  const bmp = await decodeImage(bytes, mime);
  const c = new OffscreenCanvas(16, 16);
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0, 16, 16);
  return averageLinear(ctx.getImageData(0, 0, 16, 16).data);
}

async function decodeImage(bytes, mime) {
  return createImageBitmap(new Blob([bytes], { type: mime }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

async function reencode(bytes, mime, w, h, type) {
  const bmp = await decodeImage(bytes, mime);
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await c.convertToBlob({ type, quality: 0.88 });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type };
}

// ---------- Варианты ----------
/** Ставит материалы варианта по умолчанию. Возвращает материалы, которые отличают вариант (для кружка). */
function setVariantFromExt(doc, name) {
  const root = doc.getRoot();
  const ext = root.listExtensionsUsed().find((e) => e.extensionName === 'KHR_materials_variants');
  const changed = new Set();
  if (!ext) return changed;
  const variant = ext.listVariants().find((v) => v.getName() === name);
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
    const list = prim.getExtension('KHR_materials_variants');
    if (!list || !variant) continue;
    for (const m of list.listMappings()) if (m.listVariants().includes(variant)) { prim.setMaterial(m.getMaterial()); changed.add(m.getMaterial()); }
  }
  return changed;
}
function dropVariantsExt(doc) {
  doc.getRoot().listExtensionsUsed().find((e) => e.extensionName === 'KHR_materials_variants')?.dispose();
}

// Перекраска текстуры: оттенок заменяется целевым, яркостный рисунок (фактура) сохраняется.
// Тот же алгоритм, что в scripts/build-models.mjs, только на canvas.
const LIN = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const toSrgb8 = (c) => Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));
const hexToLin = (hex) => [1, 3, 5].map((i) => LIN[parseInt(hex.slice(i, i + 2), 16)]);
const linToHex = (rgb) => '#' + rgb.map((c) => toSrgb8(Math.min(1, Math.max(0, c))).toString(16).padStart(2, '0')).join('');

async function recolorTexture(bytes, mime, hex, threshold) {
  const bmp = await decodeImage(bytes, mime);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const t = threshold / 100 * 0.5; // порог в линейной яркости
  const mask = (lum) => (t <= 0 ? 1 : Math.min(1, Math.max(0, (lum - (t - 0.03)) / 0.06)));
  let sum = 0, wsum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.2126 * LIN[d[i]] + 0.7152 * LIN[d[i + 1]] + 0.0722 * LIN[d[i + 2]];
    const w = mask(lum); sum += lum * w; wsum += w;
  }
  const ref = Math.max(sum / Math.max(wsum, 1e-6), 1e-4);
  const target = hexToLin(hex);
  for (let i = 0; i < d.length; i += 4) {
    const r = LIN[d[i]], g = LIN[d[i + 1]], b = LIN[d[i + 2]];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const w = mask(lum);
    if (w <= 0) continue;
    const k = lum / ref;
    d[i] = toSrgb8(Math.min(1, r * (1 - w) + target[0] * k * w));
    d[i + 1] = toSrgb8(Math.min(1, g * (1 - w) + target[1] * k * w));
    d[i + 2] = toSrgb8(Math.min(1, b * (1 - w) + target[2] * k * w));
  }
  ctx.putImageData(img, 0, 0);
  const type = mime === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await c.convertToBlob({ type, quality: 0.88 });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type };
}

async function applyManualColor(doc, matIndex, hex, threshold) {
  const root = doc.getRoot();
  const mat = root.listMaterials()[matIndex];
  if (!mat) return;
  const tex = mat.getBaseColorTexture();
  const alpha = mat.getBaseColorFactor()[3];
  if (tex) {
    const { bytes, type } = await recolorTexture(tex.getImage(), tex.getMimeType(), hex, threshold);
    const copy = doc.createTexture(`${tex.getName() || 'baseColor'}_${hex.slice(1)}`).setImage(bytes).setMimeType(type);
    mat.setBaseColorTexture(copy);
    mat.setBaseColorFactor([1, 1, 1, alpha]); // оттенок поверх текстуры не доходит до Quick Look — запекаем
  } else {
    mat.setBaseColorFactor([...hexToLin(hex), alpha]);
  }
}

/** Средний цвет «основного» материала — для кружка выбора. */
async function guessSwatch(doc, prefer) {
  const root = doc.getRoot();
  const weight = new Map();
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
    const m = p.getMaterial(); if (!m || (prefer?.size && !prefer.has(m))) continue;
    weight.set(m, (weight.get(m) ?? 0) + (p.getAttribute('POSITION')?.getCount() ?? 0));
  }
  const mat = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!mat) return '#cccccc';
  const f = mat.getBaseColorFactor();
  const tex = mat.getBaseColorTexture();
  if (!tex) return linToHex(f.slice(0, 3));
  try {
    const bmp = await decodeImage(tex.getImage(), tex.getMimeType());
    const c = new OffscreenCanvas(16, 16); const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0, 16, 16);
    const d = ctx.getImageData(0, 0, 16, 16).data;
    const acc = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) { acc[0] += LIN[d[i]]; acc[1] += LIN[d[i + 1]]; acc[2] += LIN[d[i + 2]]; }
    return linToHex(acc.map((v, k) => (v / 256) * f[k]));
  } catch { return linToHex(f.slice(0, 3)); }
}

// =====================================================================
// 3. Режим вариантов и таблица
// =====================================================================
function slug(s) {
  const map = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  return String(s).toLowerCase().split('').map((ch) => map[ch] ?? ch).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item';
}

function setupVariantMode() {
  const multi = S.sources.length > 1;
  const ext = S.sources[0].variantNames;
  const modes = [];
  if (multi) modes.push(['files', `По файлу на вариант (${S.sources.length})`]);
  if (!multi && ext.length) modes.push(['ext', `Варианты из файла (${ext.length})`]);
  if (!multi) modes.push(['single', 'Один вариант (как есть)'], ['manual', 'Добавить цвета вручную']);
  S.variantMode = modes[0][0];
  $('variant-mode').innerHTML = modes.map(([v, l], i) =>
    `<label><input type="radio" name="vmode" value="${v}" ${i === 0 ? 'checked' : ''}><span>${l}</span></label>`).join('');
  const info = S.sources[0].info;
  $('manual-material').innerHTML = info.materialList.map((m) =>
    `<option value="${m.i}">${esc(m.name)}${m.textured ? ' (с текстурой)' : ' (без текстуры)'}</option>`).join('');
  // Предлагаем материал с наибольшей площадью.
  S.manual.material = 0;
  resetRows();
}

function resetRows() {
  const info = S.sources[0].info;
  if (S.variantMode === 'ext') {
    S.rows = info.variants.map((n) => ({ id: slug(n), name: n, swatch: '#cccccc', swatchTouched: false, src: n }));
  } else if (S.variantMode === 'files') {
    S.rows = S.sources.map((s, i) => {
      const base = s.name.replace(/\.glb$/i, '');
      const v = base.includes('__') ? base.split('__').pop() : base;
      return { id: slug(v), name: v, swatch: '#cccccc', swatchTouched: false, src: i };
    });
  } else if (S.variantMode === 'manual') {
    S.rows = [
      { id: 'original', name: 'Как в модели', swatch: '#cccccc', swatchTouched: false, src: null },
      { id: 'graphite', name: 'Графит', swatch: '#4a4c50', swatchTouched: true, src: '#4a4c50' },
    ];
  } else {
    S.rows = [{ id: 'default', name: 'Основной', swatch: '#cccccc', swatchTouched: false, src: null }];
  }
  renderVariantUi();
}

function renderVariantUi() {
  const m = S.variantMode;
  $('manual-box').hidden = m !== 'manual';
  $('manual-add').hidden = m !== 'manual';
  const mat = S.sources[0].info.materialList[S.manual.material];
  $('threshold-wrap').hidden = !mat?.textured;
  $('manual-material-note').textContent = mat?.textured
    ? 'Цвет будет «запечён» в копию текстуры — так он сохранится и в Quick Look на iPhone.'
    : 'Материал без текстуры: меняется его цвет.';
  $('variant-note').textContent = {
    ext: 'В файле есть варианты (KHR_materials_variants). Каждый станет отдельным GLB — так его увидит и Android Scene Viewer.',
    files: 'Каждый файл — отдельный вариант. Исправления масштаба и опоры применяются ко всем одинаково (рассчитываются по первому файлу).',
    single: S.st.keepVariants
      ? 'Один файл с KHR_materials_variants как есть (нарезка выключена из-за ошибок). Scene Viewer на Android покажет только вариант по умолчанию.'
      : 'У товара будет один вариант. Чтобы добавить цвета, выберите «Добавить цвета вручную».',
    manual: 'Первая строка — исходный цвет модели. Для остальных выберите цвет: он заменит оттенок выбранного материала.',
  }[m];
  $('var-body').innerHTML = S.rows.map((r, i) => {
    const b = S.built[i];
    return `<tr>
      <td><input type="color" data-i="${i}" data-k="swatch" value="${esc(r.swatch)}" aria-label="Цвет кружка"></td>
      <td><input type="text" data-i="${i}" data-k="name" value="${esc(r.name)}" aria-label="Название варианта"></td>
      <td><input type="text" data-i="${i}" data-k="id" value="${esc(r.id)}" aria-label="Код варианта" pattern="[a-z0-9\\-]+"></td>
      <td>${b ? MB(b.bytes.byteLength) : '…'}</td>
      <td>${m === 'manual' && i > 0 ? `<button type="button" class="btn btn-small btn-danger" data-rm="${i}">Убрать</button>` : ''}</td>
    </tr>`;
  }).join('');
}

$('variant-mode').addEventListener('change', (e) => { S.variantMode = e.target.value; S.st.keepVariants = false; resetRows(); scheduleRebuild(); });
$('manual-material').addEventListener('change', (e) => { S.manual.material = +e.target.value; renderVariantUi(); scheduleRebuild(); });
$('manual-threshold').addEventListener('input', (e) => { S.manual.threshold = +e.target.value; $('threshold-val').textContent = `${e.target.value}%`; scheduleRebuild(); });
$('manual-add').addEventListener('click', () => {
  const palette = ['#c99a2e', '#2f6b55', '#8e3b2e', '#2e4a7a', '#b8b0a2'];
  const hex = palette[(S.rows.length - 1) % palette.length];
  S.rows.push({ id: `color-${S.rows.length}`, name: `Цвет ${S.rows.length}`, swatch: hex, swatchTouched: true, src: hex });
  renderVariantUi();
  scheduleRebuild();
});
$('var-body').addEventListener('change', (e) => {
  const t = e.target; const r = S.rows[+t.dataset.i];
  if (!r || !t.dataset.k) return;
  if (t.dataset.k === 'id') t.value = slug(t.value);
  r[t.dataset.k] = t.value;
  if (t.dataset.k === 'swatch') {
    r.swatchTouched = true;
    if (S.variantMode === 'manual' && +t.dataset.i > 0) { r.src = t.value; scheduleRebuild(); }
  }
  if (S.built[+t.dataset.i]) Object.assign(S.built[+t.dataset.i], { id: r.id, name: r.name, swatch: r.swatch });
  renderPreviewVariants();
});
$('var-body').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rm]'); if (!b) return;
  S.rows.splice(+b.dataset.rm, 1); renderVariantUi(); scheduleRebuild();
});

// =====================================================================
// Сборка всех вариантов + проверка результата
// =====================================================================
/** Собирает один вариант с заданными настройками. Ничего не меняет в S. */
async function buildOne(r, st, { swatch: wantSwatch = true } = {}) {
  const src = S.variantMode === 'files' ? S.sources[r.src] : S.sources[0];
  const doc = await io.readBinary(src.bytes);
  let prefer = new Set();
  if (!st.keepVariants) {
    if (S.variantMode === 'ext') prefer = setVariantFromExt(doc, r.src);
    dropVariantsExt(doc);
  }
  if (S.variantMode === 'manual') prefer = new Set([doc.getRoot().listMaterials()[S.manual.material]].filter(Boolean));
  if (S.variantMode === 'manual' && r.src) await applyManualColor(doc, S.manual.material, r.src, S.manual.threshold);
  // Цвет кружка — до исправлений: dedup может заменить объекты материалов.
  const swatch = wantSwatch ? (r.swatchTouched ? r.swatch : await guessSwatch(doc, prefer)) : null;
  const { uvWarnings } = await applyFixes(doc, st);
  const bytes = await io.writeBinary(doc);
  const report = await L.validateBytes(bytes, { maxIssues: 50 });
  return { src, doc, bytes, report, swatch, uvWarnings, srcErr: src.report?.issues.numErrors ?? 0 };
}

// Шаги обработки, которые можно выключить. Если после обработки ошибок валидатора больше, чем в исходнике,
// diagnose() пересобирает вариант без каждого шага по очереди и находит виноватый.
const STEPS = [
  { key: 'textures', label: 'Сжатие текстур (JPEG/PNG, ≤ 2048 px)', on: (st, a) => st.textures && a.textures.length > 0 },
  { key: 'keepVariants', label: 'Нарезка вариантов (KHR_materials_variants)', on: (st, a) => !st.keepVariants && a.variants.length > 0, off: true },
  { key: 'stripAnim', label: 'Удаление анимаций и скелета', on: (st, a) => st.stripAnim && (a.animations > 0 || a.skins > 0) },
  { key: 'simplify', label: 'Упрощение сетки', on: (st) => st.simplify },
  { key: 'uv', label: 'Один набор UV', on: (st, a) => st.uv && a.uvSets > 1 },
  { key: 'cleanup', label: 'Чистка (dedup / prune)', on: (st) => st.cleanup },
];
const stepOff = (st, step) => ({ ...st, [step.key]: step.off ?? false });
const errCodes = (report) => (report?.issues.messages ?? []).filter((m) => m.severity === 0).map((m) => m.code);

async function diagnose(built, seq) {
  const idx = built.findIndex((b) => b.report.issues.numErrors > b.srcErr);
  if (idx < 0) return null;
  const b = built[idx];
  const srcCodes = new Set(errCodes(b.src.report));
  const newCodes = [...new Set(errCodes(b.report).filter((c) => !srcCodes.has(c)))];
  const tried = [];
  for (const step of STEPS.filter((x) => x.on(S.st, b.src.info))) {
    status('build-status', `Ищем шаг, который добавил ошибки: проверяем без «${step.label}»…`, 'busy');
    const res = await buildOne(S.rows[idx], stepOff(S.st, step), { swatch: false });
    if (seq !== S.buildSeq) return undefined;
    tried.push({ step, errs: res.report.issues.numErrors });
  }
  return {
    idx, variant: S.rows[idx].name, srcErr: b.srcErr, outErr: b.report.issues.numErrors, newCodes, tried,
    culprits: tried.filter((t) => t.errs <= b.srcErr).map((t) => t.step),
  };
}

function renderBlame() {
  const box = $('blame-box');
  const bl = S.blame;
  box.hidden = !bl;
  if (!bl) return;
  const head = `<p><strong>Обработка добавила ошибки валидатора.</strong> ${S.built.length > 1 ? `Вариант «${esc(bl.variant)}»: ` : ''}в исходнике ${bl.srcErr}, после обработки ${bl.outErr}${bl.newCodes.length ? ` (${bl.newCodes.map(esc).join(', ')})` : ''}.</p>`;
  if (bl.culprits.length) {
    box.innerHTML = `${head}<p>Виноват шаг: ${bl.culprits.map((c) => `«${esc(c.label)}»`).join(' или ')} — без него ошибок не больше, чем в исходнике.</p>
      <div class="row">${bl.culprits.map((c) => `<button type="button" class="btn btn-small" data-skip-step="${c.key}">Выгрузить без шага «${esc(c.label)}»</button>`).join('')}</div>`;
  } else {
    box.innerHTML = `${head}<p>${bl.tried.length
      ? `Ни один шаг по отдельности не объясняет новые ошибки (проверены: ${bl.tried.map((t) => `«${esc(t.step.label)}» → ${t.errs}`).join(', ')}). Выключайте исправления по очереди вручную или пришлите файл разработчику.`
      : 'Выключаемых шагов нет — пришлите файл разработчику.'}</p>`;
  }
}

$('blame-box').addEventListener('click', (e) => {
  const b = e.target.closest('[data-skip-step]');
  if (!b) return;
  const key = b.dataset.skipStep;
  if (key === 'keepVariants') {
    // Без нарезки: один файл с KHR_materials_variants как есть.
    S.st.keepVariants = true;
    S.variantMode = 'single';
    const radio = document.querySelector('#variant-mode input[value="single"]');
    if (radio) radio.checked = true;
    resetRows();
  } else {
    S.st[key] = false;
    syncControls();
  }
  rebuild();
});

async function rebuild() {
  if (!S.sources.length) return;
  const seq = ++S.buildSeq;
  status('build-status', 'Обработка…', 'busy');
  try {
    readControls();
    const built = [];
    for (let i = 0; i < S.rows.length; i++) {
      const r = S.rows[i];
      const res = await buildOne(r, S.st);
      if (seq !== S.buildSeq) return; // настройки поменялись — эта сборка устарела
      if (!r.swatchTouched) r.swatch = res.swatch;
      built.push({ id: r.id, name: r.name, swatch: r.swatch, ...res });
      built.at(-1).autoBg = (await guessShowcaseBg(res.doc, avgTextureLinear)).bg; // фон витрины
    }
    if (seq !== S.buildSeq) return;
    const blame = await diagnose(built, seq);
    if (blame === undefined) return;
    S.blame = blame;
    S.built.forEach((b) => b.url && URL.revokeObjectURL(b.url));
    S.built = built;
    S.builtInfo = inspectDoc(built[0].doc);
    S.pv = Math.min(S.pv, built.length - 1);
    status('build-status', '');
    renderChecks();
    renderBlame();
    renderVariantUi();
    renderPreviewVariants();
    fillDims();
    await showPreview();
  } catch (e) {
    console.error(e);
    if (seq !== S.buildSeq) return;
    showError('build-status', `Ошибка обработки: ${e.message}`, strippable(S.sources[0], e.message ?? ''));
  }
}

// ---------- Таблица проверок ----------
function renderChecks() {
  const src = S.sources[0];
  const a = src.info, b = S.builtInfo, st = S.st;
  const rows = [];
  const add = (state, label, before, after, sub = '') => rows.push({ state, label, before, after, sub });

  // Валидность
  const srcErr = src.report?.issues.numErrors ?? 0, srcWarn = src.report?.issues.numWarnings ?? 0;
  const outErr = Math.max(...S.built.map((x) => x.report.issues.numErrors));
  add(outErr ? 'err' : 'ok', 'glTF-валидатор (Khronos)', `ошибок ${srcErr}, предупр. ${srcWarn}`, `ошибок ${outErr}`,
    S.blame ? 'Ошибки добавила обработка — какой шаг виноват, написано под таблицей.'
      : outErr ? 'Scene Viewer не откроет модель с ошибками — нужна правка в 3D-редакторе.' : srcErr ? 'Ошибки исходника исправлены пересохранением.' : '');

  // Вес
  const srcMB = src.bytes.byteLength / 1048576;
  const outMax = Math.max(...S.built.map((x) => x.bytes.byteLength)) / 1048576;
  add(outMax > LIMITS.errMB ? 'err' : outMax > LIMITS.warnMB ? 'warn' : 'ok', 'Вес файла (на вариант)',
    MB(src.bytes.byteLength), `${outMax.toFixed(2)} МБ`, outMax > LIMITS.warnMB ? `Рекомендуется ≤ ${LIMITS.warnMB} МБ: долго грузится на телефоне. Уменьшите текстуры или упростите сетку.` : srcMB > LIMITS.warnMB ? 'Уменьшено.' : '');

  // Масштаб
  const sz = b.size.map(cm);
  const maxCm = Math.max(...sz);
  const [lo, hi] = PLAUSIBLE[st.category];
  const scaleState = maxCm < HARD[0] || maxCm > HARD[1] ? 'err' : maxCm < lo || maxCm > hi ? 'warn' : 'ok';
  add(scaleState, 'Реальный размер (Ш×Г×В)', [a.size[0], a.size[2], a.size[1]].map((m) => fmtLen(m)).join(' × ') + ' (как есть)', `${sz[0]} × ${sz[2]} × ${sz[1]} см`,
    scaleState === 'err' ? `Слишком ${maxCm < HARD[0] ? 'маленький' : 'большой'} предмет — проверьте единицы модели.`
      : scaleState === 'warn' ? `Необычно для «${CATEGORIES[st.category].label.toLowerCase()}» (ожидается ${lo}–${hi} см по наибольшей стороне). Проверьте единицы.` : '');

  // Опора
  const lift = st.category === 'wall' ? a.min[2] : a.min[1];
  const off = Math.hypot((a.min[0] + a.max[0]) / 2, st.category === 'wall' ? (a.min[1] + a.max[1]) / 2 : (a.min[2] + a.max[2]) / 2);
  const bLift = st.category === 'wall' ? b.min[2] : b.min[1];
  add(Math.abs(bLift) < 0.002 ? 'ok' : 'warn', 'Точка опоры',
    `${st.category === 'wall' ? 'задняя грань' : 'низ'}: ${fmtSigned(lift * st.scale)}, смещение центра ${fmtLen(off * st.scale)}`,
    Math.abs(bLift) < 0.002 ? (st.category === 'wall' ? 'задняя грань на опоре' : 'стоит на опоре') : `низ: ${fmtSigned(bLift)}`,
    Math.abs(bLift) >= 0.002 ? 'Включите «Поставить на пол».' : '');

  // Треугольники
  add(b.tris > LIMITS.tris ? 'warn' : 'ok', 'Треугольники', a.tris.toLocaleString('ru'), b.tris.toLocaleString('ru'),
    b.tris > LIMITS.tris ? `Больше ${LIMITS.tris.toLocaleString('ru')} — включите упрощение.` : '');

  // Материалы
  add(b.materials > LIMITS.materials ? 'warn' : 'ok', 'Материалы', String(a.materials), String(b.materials), b.materials > LIMITS.materials ? 'Scene Viewer рекомендует не больше 10.' : '');

  // Текстуры
  const fmts = (info) => [...new Set(info.textures.map((t) => t.mime.replace('image/', '').toUpperCase()))].join(', ') || 'нет';
  const texBad = b.maxTex > LIMITS.tex || b.textures.some((t) => !['image/jpeg', 'image/png'].includes(t.mime));
  add(texBad ? 'warn' : 'ok', 'Текстуры', a.textures.length ? `${a.textures.length} шт., до ${a.maxTex} px, ${fmts(a)}` : 'нет',
    b.textures.length ? `${b.textures.length} шт., до ${b.maxTex} px, ${fmts(b)}` : 'нет', texBad ? 'Включите «Текстуры ≤ 2048 px».' : '');

  // Расширения
  const forb = a.ext.filter((e) => FORBIDDEN[e]);
  const remov = a.ext.filter((e) => REMOVABLE[e]);
  const leftBad = b.ext.filter((e) => FORBIDDEN[e] || REMOVABLE[e]);
  add(forb.length || leftBad.length ? 'err' : remov.length ? 'info' : 'ok', 'Расширения glTF', a.ext.join(', ') || 'нет', b.ext.join(', ') || 'нет',
    [...forb.map((e) => FORBIDDEN[e]), ...remov.map((e) => REMOVABLE[e]), S.stripped.length ? `Убрано по вашей команде: ${S.stripped.join(', ')}.` : ''].join(' ').trim());

  // Анимации
  if (a.animations || a.skins) add(b.animations || b.skins ? 'warn' : 'ok', 'Анимации / скелет', `${a.animations} / ${a.skins}`, `${b.animations} / ${b.skins}`, b.animations ? 'Для мебели не нужны — включите удаление.' : '');

  // UV
  if (a.uvSets > 1) {
    const lost = new Map(); // слот → материалы
    for (const x of S.built) for (const w of x.uvWarnings ?? []) {
      if (!lost.has(w.slot)) lost.set(w.slot, new Set());
      lost.get(w.slot).add(w.material);
    }
    const lostText = [...lost].map(([slot, mats]) => `${slotLabel(slot)} — у материалов ${[...mats].map((m) => `«${m}»`).join(', ')}`).join('; ');
    add(lost.size ? 'warn' : 'info', 'Наборы UV', String(a.uvSets), String(b.uvSets),
      !st.uv ? 'Второй набор оставлен как есть.'
        : lost.size ? `Убрано: ${lostText}. Эти текстуры лежали на второй развёртке (TEXCOORD_1), а она не совпадает с первой — на первую они не лягут. Если затенение важно, запеките его в основную текстуру в 3D-редакторе.`
          : 'Сведено к одному набору: текстуры второй развёртки переведены на первую (развёртки совпадают).');
  }

  // Варианты
  add(st.keepVariants ? 'warn' : 'ok', 'Варианты', a.variants.length ? `${a.variants.length} в файле (KHR_materials_variants)` : S.sources.length > 1 ? `${S.sources.length} файла` : 'нет',
    st.keepVariants ? '1 GLB с вариантами внутри' : `${S.built.length} отдельных GLB`,
    st.keepVariants ? 'Нарезка выключена: Scene Viewer на Android покажет только вариант по умолчанию.' : '');

  $('check-body').innerHTML = rows.map((r) => `<tr>
    <td class="st st-${r.state}" aria-label="${{ ok: 'норма', warn: 'внимание', err: 'ошибка', info: 'информация' }[r.state]}"></td>
    <td>${esc(r.label)}${r.sub ? `<span class="sub">${esc(r.sub)}</span>` : ''}</td>
    <td>${esc(r.before)}</td><td>${esc(r.after)}</td></tr>`).join('');

  // Сообщения валидатора (исходник + первый результат)
  const msgs = [
    ...(src.report?.issues.messages ?? []).filter((m) => m.severity <= 1).map((m) => ({ ...m, where: 'исходник' })),
    ...S.built[0].report.issues.messages.filter((m) => m.severity <= 1).map((m) => ({ ...m, where: 'после' })),
  ];
  $('validator-details').hidden = !msgs.length;
  $('validator-list').innerHTML = msgs.slice(0, 60).map((m) =>
    `<li class="${m.severity === 0 ? 'e' : ''}">[${m.where}] ${m.severity === 0 ? 'Ошибка' : 'Предупр.'} ${esc(m.code)}: ${esc(m.message)} <code>${esc(m.pointer ?? '')}</code></li>`).join('');
  S.checks = { outErr, forb, outMax, scaleState };
  updateExportState();
}

/** Почему нельзя выгрузить — пишем рядом с серой кнопкой. */
function exportBlockers() {
  const out = [];
  const c = S.checks;
  if (!c) return ['Сначала загрузите модель (шаг 1)'];
  if (!$('f-name').value.trim()) out.push('Заполните название (шаг 5)');
  if (c.outErr) out.push(`Ошибки валидатора после обработки: ${c.outErr} (шаг 2)`);
  if (c.forb.length) out.push(`Недопустимое расширение: ${c.forb.join(', ')} (шаг 2)`);
  if (c.outMax > LIMITS.errMB) out.push(`Файл больше ${LIMITS.errMB} МБ — уменьшите текстуры или упростите сетку (шаг 2)`);
  if (c.scaleState === 'err') out.push('Неверный масштаб — проверьте единицы модели (шаг 2)');
  return out;
}
function updateExportState() {
  const reasons = exportBlockers();
  $('export-zip').disabled = reasons.length > 0;
  $('export-reason').hidden = !reasons.length;
  $('export-reason').textContent = reasons.length ? `Кнопка недоступна: ${reasons.join('; ')}.` : '';
}
const fmtSigned = (m) => `${m >= 0 ? '+' : '−'}${fmtLen(Math.abs(m))}`;

// =====================================================================
// 4. Превью (+ человек 175 см, проверка USDZ)
// =====================================================================
const viewer = $('admin-viewer');

function renderPreviewVariants() {
  $('pv-variants').innerHTML = S.built.map((b, i) =>
    `<label><input type="radio" name="pv" value="${i}" ${i === S.pv ? 'checked' : ''}><span><span class="dot" style="display:inline-block;vertical-align:-2px;margin-right:6px;background:${esc(S.rows[i]?.swatch)}"></span>${esc(S.rows[i]?.name ?? b.name)}</span></label>`).join('');
}
$('pv-variants').addEventListener('change', (e) => { S.pv = +e.target.value; showPreview(); });

// Фон на витрине (поле bg в catalog.json): авто по яркости модели или вручную для всех вариантов.
const BG_LABEL = { dark: 'тёмно-серый (светлый предмет)', light: 'светлый (тёмный предмет)', mid: 'средне-серый (смешанный предмет)' };
const bgFor = (i) => $('pv-bg').value || S.built[i]?.autoBg || 'mid';
function renderBg() {
  const autos = [...new Set(S.built.map((b) => b.autoBg))];
  $('pv-bg').options[0].textContent = `Авто: ${autos.length === 1 ? BG_LABEL[autos[0]] : 'свой у каждого варианта'}`;
  const bg = bgFor(S.pv);
  if (bg === 'mid') delete viewer.dataset.bg; else viewer.dataset.bg = bg;
}
$('pv-bg').addEventListener('change', renderBg);
$('pv-human').addEventListener('change', (e) => { S.human = e.target.checked; showPreview(); });

function fillDims() {
  const [w, h, d] = S.builtInfo.size.map(cm);
  $('pv-dims').innerHTML = `<span>Ш ${w} см</span><span>Г ${d} см</span><span>В ${h} см</span>`;
  $('f-w').value = Math.round(w); $('f-d').value = Math.round(d); $('f-h').value = Math.round(h);
}

let previewUrl = null;
async function showPreview() {
  const b = S.built[S.pv];
  if (!b) return;
  let bytes = b.bytes;
  if (S.human) {
    const doc = await io.readBinary(b.bytes);
    addHuman(doc, S.builtInfo);
    bytes = await io.writeBinary(doc);
  }
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' }));
  viewer.src = previewUrl;
  renderBg();
  $('usdz-result').textContent = '';
}

/** Условный человек 175 см — только для превью, в каталог не попадает. */
function addHuman(doc, info) {
  const root = doc.getRoot();
  const buf = root.listBuffers()[0] ?? doc.createBuffer();
  const mat = doc.createMaterial('preview_human').setBaseColorFactor([0.36, 0.38, 0.42, 1]).setRoughnessFactor(0.9).setMetallicFactor(0);
  const parts = [
    new THREE.CylinderGeometry(0.075, 0.065, 0.86, 20).translate(-0.1, 0.43, 0),
    new THREE.CylinderGeometry(0.075, 0.065, 0.86, 20).translate(0.1, 0.43, 0),
    new THREE.CylinderGeometry(0.2, 0.17, 0.62, 24).translate(0, 1.17, 0),
    new THREE.CylinderGeometry(0.05, 0.045, 0.6, 16).translate(-0.25, 1.12, 0),
    new THREE.CylinderGeometry(0.05, 0.045, 0.6, 16).translate(0.25, 1.12, 0),
    new THREE.SphereGeometry(0.105, 24, 16).translate(0, 1.645, 0),
  ];
  const node = doc.createNode('preview_human_175cm').setTranslation([info.max[0] + 0.45, info.min[1], (info.min[2] + info.max[2]) / 2]);
  const mesh = doc.createMesh('human');
  for (const g of parts) {
    const ng = g.index ? g : g;
    const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
    mesh.addPrimitive(doc.createPrimitive()
      .setAttribute('POSITION', acc('VEC3', new Float32Array(ng.attributes.position.array)))
      .setAttribute('NORMAL', acc('VEC3', new Float32Array(ng.attributes.normal.array)))
      .setIndices(acc('SCALAR', new Uint32Array(ng.index.array)))
      .setMaterial(mat));
  }
  node.setMesh(mesh);
  (root.getDefaultScene() ?? root.listScenes()[0]).addChild(node);
}

$('usdz-test').addEventListener('click', async () => {
  $('usdz-result').className = 'note';
  $('usdz-result').textContent = 'Собираем USDZ…';
  if (S.human) { S.human = false; $('pv-human').checked = false; await showPreview(); }
  await waitLoaded();
  const t0 = performance.now();
  try {
    const url = await viewer.prepareUSDZ();
    const size = (await (await fetch(url)).blob()).size;
    URL.revokeObjectURL(url);
    const sec = ((performance.now() - t0) / 1000).toFixed(1);
    $('usdz-result').textContent = `✓ USDZ собирается: ${MB(size)}, ${sec} с на этом компьютере (на телефоне время другое — проверьте на iPhone).`;
    $('usdz-result').className = `note ${size > 25 * 1048576 ? 'warn' : ''}`;
  } catch (e) {
    $('usdz-result').textContent = `✗ USDZ не собирается: ${e.message}. На iPhone AR не откроется.`;
    $('usdz-result').className = 'note err';
  }
});

function waitLoaded() {
  return viewer.loaded ? Promise.resolve() : new Promise((ok) => viewer.addEventListener('load', ok, { once: true }));
}

// =====================================================================
// 5. Карточка
// =====================================================================
function prefillCard() {
  const base = S.sources[0].name.replace(/\.glb$/i, '').split('__')[0];
  if (!$('f-name').value) $('f-name').value = '';
  $('f-id').value = slug(base);
  $('f-id').dataset.auto = '1';
}
$('f-name').addEventListener('input', updateExportState);
$('f-name').addEventListener('input', () => {
  if ($('f-id').dataset.auto === '1' && $('f-name').value.trim()) $('f-id').value = slug($('f-name').value);
});
$('f-id').addEventListener('input', () => { $('f-id').dataset.auto = '0'; });
$('f-id').addEventListener('change', () => { $('f-id').value = slug($('f-id').value); });

// =====================================================================
// 6. Выгрузка: ZIP = catalog.json + models/<id>/<вариант>.glb + posters/<id>.webp
// =====================================================================
$('export-zip').addEventListener('click', async () => {
  const name = $('f-name').value.trim();
  const id = slug($('f-id').value || name);
  if (!name) { status('export-status', 'Укажите название товара (шаг 5).', 'err'); $('f-name').focus(); return; }
  const ids = S.rows.map((r) => slug(r.id));
  if (new Set(ids).size !== ids.length) { status('export-status', 'Коды вариантов повторяются — сделайте их разными (шаг 3).', 'err'); return; }
  const exists = S.catalog.items.find((it) => it.id === id && !S.deleted.has(it.id));
  if (exists && !confirm(`Товар с кодом «${id}» уже есть в каталоге. Заменить его?`)) return;

  status('export-status', 'Готовим архив…', 'busy');
  try {
    const poster = await makePoster();
    const price = $('f-price').value === '' ? null : Number($('f-price').value);
    const item = {
      id, name,
      subtitle: $('f-subtitle').value.trim() || undefined,
      price,
      category: S.st.category,
      size_cm: { w: +$('f-w').value || 0, d: +$('f-d').value || 0, h: +$('f-h').value || 0 },
      description: $('f-desc').value.trim() || undefined,
      option_label: $('f-option').value.trim() || 'Вариант',
      poster: `posters/${id}.webp`,
      bg: bgFor(0),
      variants: S.built.map((b, i) => ({ id: slug(S.rows[i].id), name: S.rows[i].name, swatch: S.rows[i].swatch, bg: bgFor(i), model: `models/${id}/${slug(S.rows[i].id)}.glb` })),
      source: { files: S.sources.map((s) => s.name), added: new Date().toISOString().slice(0, 10) },
    };
    const catalog = catalogForExport(item);
    // Всё, что идёт на сайт, — в одной папке-обёртке SITE_DIR. Инструкция лежит рядом с ней, а не внутри,
    // чтобы её не загрузили на сайт. Так при загрузке через GitHub папки models/ и posters/ не теряются.
    const files = {
      [`${SITE_DIR}/catalog.json`]: L.strToU8(JSON.stringify(catalog, null, 2) + '\n'),
      [`${SITE_DIR}/posters/${id}.webp`]: poster,
      'КАК-ОПУБЛИКОВАТЬ.txt': L.strToU8(howtoText(item)),
    };
    S.built.forEach((b, i) => { files[`${SITE_DIR}/models/${id}/${slug(S.rows[i].id)}.glb`] = [b.bytes, { level: 0 }]; });
    const zip = L.zipSync(files, { level: 6 });
    download(new Blob([zip], { type: 'application/zip' }), `ar-catalog-${id}.zip`);

    // Обновляем каталог в памяти: следующий товар добавится к этому.
    S.catalog.items = catalog.items;
    S.deleted.clear();
    S.dirty = false;
    renderCatalog();
    status('export-status', `Готово: ar-catalog-${id}.zip (${MB(zip.byteLength)}). Товар «${name}» добавлен — выложите архив по инструкции ниже.`, 'ok');
    $('howto').hidden = false;
  } catch (e) {
    console.error(e);
    status('export-status', `Не получилось собрать архив: ${e.message}`, 'err');
  }
});

async function makePoster() {
  const humanWas = S.human;
  const pvWas = S.pv;
  S.human = false; S.pv = 0;
  await showPreview();
  await waitLoaded();
  viewer.cameraOrbit = '-30deg 75deg auto';
  viewer.jumpCameraToGoal();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await new Promise((r) => setTimeout(r, 300));
  const blob = await viewer.toBlob({ mimeType: 'image/png', idealAspect: false });
  // Квадрат 800×800, прозрачный фон, WebP.
  const bmp = await createImageBitmap(blob);
  const side = Math.min(bmp.width, bmp.height);
  const c = new OffscreenCanvas(800, 800);
  c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 800, 800);
  const out = await c.convertToBlob({ type: 'image/webp', quality: 0.85 });
  S.human = humanWas; S.pv = pvWas;
  viewer.cameraOrbit = '-25deg 75deg auto';
  await showPreview();
  return new Uint8Array(await out.arrayBuffer());
}

const SITE_DIR = 'na-sait'; // латиницей: имя папки в ZIP читается одинаково в любой системе

function howtoText(item) {
  return [
    `Товар: ${item.name} (${item.id}), вариантов: ${item.variants.length}`,
    `Собрано: ${new Date().toLocaleString('ru-RU')}`,
    '',
    '=====================================================================',
    `  ПЕРЕТАЩИТЕ ВСЁ СОДЕРЖИМОЕ ПАПКИ «${SITE_DIR}» В GITHUB МЫШКОЙ.`,
    '  НЕ ВЫБИРАЙТЕ ФАЙЛЫ ЧЕРЕЗ ОКНО «choose your files» —',
    '  ИНАЧЕ GITHUB ПОТЕРЯЕТ ПАПКИ И САЙТ НЕ НАЙДЁТ МОДЕЛИ.',
    '=====================================================================',
    '',
    `Что в папке «${SITE_DIR}» (только это идёт на сайт):`,
    '  catalog.json            — весь каталог (заменяет текущий)',
    `  models/${item.id}/      — модели по вариантам`,
    `  posters/${item.id}.webp — картинка для каталога`,
    'Этот файл с инструкцией и сам ZIP на сайт НЕ загружайте.',
    '',
    'Как опубликовать на GitHub Pages (без git):',
    '  1. Распакуйте архив.',
    `  2. Откройте папку «${SITE_DIR}» и выделите в ней всё (Ctrl+A): catalog.json, models, posters.`,
    '  3. GitHub → репозиторий → Add file → Upload files.',
    '  4. ПЕРЕТАЩИТЕ выделенное мышкой в окно GitHub. В списке GitHub должен показать пути с папками:',
    `     models/${item.id}/….glb и posters/${item.id}.webp.`,
    '     Если видны просто имена .glb без «models/» — папки потерялись: обновите страницу и перетащите снова.',
    '  5. Commit changes. Через 1–2 минуты товар появится на сайте.',
    '',
    `Через git: скопируйте содержимое папки «${SITE_DIR}» в папку проекта → git add . → git commit → git push.`,
    '',
  ].join('\r\n');
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

boot();
