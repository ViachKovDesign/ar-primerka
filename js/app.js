import { loadCatalog, CATEGORIES, AR_MODES, modelUrl, posterUrl, formatPrice } from './catalog.js';

const $ = (id) => document.getElementById(id);
const viewer = $('viewer');

// ---------- Устройство ----------
const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(ua);
const isMobile = Boolean(navigator.userAgentData?.mobile) || isIOS || isAndroid
  || matchMedia('(hover: none) and (pointer: coarse)').matches;
// Встроенные браузеры мессенджеров и соцсетей часто не умеют запускать Quick Look / Scene Viewer.
const isInApp = /FBAN|FBAV|Instagram|Telegram|VKClient|OKApp|Line\/|MicroMessenger|; wv\)/i.test(ua);
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || location.protocol === 'file:';

const state = { item: null, variant: null, arFailed: false, sceneViewerFailed: false, lastPath: '—', filter: 'all' };
let CATALOG = [];
let CURRENCY = 'RUB';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Отладка (?debug=1) ----------
const DEBUG = new URLSearchParams(location.search).has('debug');
const logLines = [];
function dlog(msg) {
  const t = new Date().toTimeString().slice(0, 8);
  logLines.push(`${t} ${msg}`);
  if (logLines.length > 14) logLines.shift();
  if (DEBUG) console.log('[AR]', msg);
  updateDebug();
}

// ---------- Собственный WebXR (Android): кольцо-указатель, постановка по касанию ----------
// Модуль (с three.js) грузится заранее, чтобы по нажатию сразу вызвать requestSession():
// браузер разрешает его только в обработчике жеста пользователя.
const xr = { mod: null, supported: null, failed: false, loading: false };
async function prepareXR() {
  if (xr.mod || xr.loading || !isMobile || isIOS || !navigator.xr || !window.isSecureContext) {
    if (xr.supported === null && (!navigator.xr || isIOS || !isMobile)) xr.supported = false;
    return;
  }
  xr.loading = true;
  try {
    const mod = await import('./xr-ar.js');
    xr.supported = await mod.isSupported();
    xr.mod = mod;
    dlog(`свой WebXR: ${xr.supported ? 'поддерживается' : 'immersive-ar не поддерживается'}`);
  } catch (e) {
    xr.supported = false;
    dlog(`свой WebXR: ошибка загрузки — ${e.message}`);
  }
  xr.loading = false;
  updateArUi();
}

function arPath() {
  if (xr.mod && xr.supported && !xr.failed) return 'свой WebXR (hit-test + кольцо)';
  if (isIOS) return 'model-viewer → Quick Look';
  if (viewer.canActivateAR) return `model-viewer → ${viewer.getAttribute('ar-modes')} (первый доступный)`;
  return 'AR недоступен (на компьютере — QR)';
}

function updateDebug() {
  if (!DEBUG) return;
  const panel = $('debug-panel');
  panel.hidden = false;
  panel.textContent = [
    'ОТЛАДКА AR (?debug=1) — пришлите скриншот',
    `устройство: ${isIOS ? 'iOS' : isAndroid ? 'Android' : 'другое'}${isMobile ? ', мобильное' : ''}${isInApp ? ', ВСТРОЕННЫЙ браузер' : ''}`,
    `UA: ${ua}`,
    `secure context: ${window.isSecureContext}, navigator.xr: ${navigator.xr ? 'есть' : 'нет'}, immersive-ar: ${xr.supported === null ? 'проверяется…' : xr.supported}`,
    `canActivateAR (model-viewer): ${viewer.canActivateAR}`,
    `ar-modes: ${viewer.getAttribute('ar-modes') ?? '—'}, ar-scale: ${viewer.getAttribute('ar-scale') ?? '—'}`,
    `ar-status: ${viewer.getAttribute('ar-status') ?? '—'}, ar-tracking: ${viewer.getAttribute('ar-tracking') ?? '—'}`,
    `режим по нажатию: ${arPath()}`,
    `последний запуск: ${state.lastPath}`,
    `модель: ${state.item ? modelUrl(state.item, state.variant) : '—'}`,
    '— журнал —',
    ...logLines,
  ].join('\n');
}

// ---------- Каталог ----------
function renderFilters() {
  const present = Object.keys(CATEGORIES).filter((c) => CATALOG.some((it) => it.category === c));
  const box = $('filters');
  box.hidden = present.length < 2;
  box.innerHTML = [['all', 'Все'], ...present.map((c) => [c, CATEGORIES[c].label])].map(([id, label]) =>
    `<button type="button" class="chip" data-filter="${id}" aria-pressed="${state.filter === id}">${label}</button>`).join('');
}

function renderCatalog() {
  const list = CATALOG.filter((it) => state.filter === 'all' || it.category === state.filter);
  $('catalog-grid').innerHTML = list.map((item) => `
    <li>
      <a class="card" href="?item=${encodeURIComponent(item.id)}" data-item="${esc(item.id)}">
        <div class="card-img">
          ${posterUrl(item) ? `<img src="${esc(posterUrl(item))}" alt="" width="400" height="400" loading="lazy" decoding="async">` : ''}
        </div>
        <div class="card-body">
          <span class="card-title">${esc(item.name)}</span>
          ${item.price != null ? `<span class="card-price">${formatPrice(item.price, CURRENCY)}</span>` : ''}
          <span class="card-meta">${dims(item)}</span>
          <span class="card-dots" aria-label="Вариантов: ${item.variants.length}">
            ${item.variants.map((v) => `<span class="dot" style="background:${esc(v.swatch || '#ccc')}"></span>`).join('')}
          </span>
        </div>
      </a>
    </li>`).join('');
}

$('filters').addEventListener('click', (e) => {
  const b = e.target.closest('[data-filter]');
  if (!b) return;
  state.filter = b.dataset.filter;
  renderFilters();
  renderCatalog();
});

const dims = ({ size_cm: { w, d, h } }) => `${w} × ${d} × ${h} см`;

// ---------- Карточка ----------
function showProduct(item, variant) {
  state.item = item;
  const cat = CATEGORIES[item.category];
  $('product-title').textContent = item.name;
  $('product-subtitle').textContent = item.subtitle ?? '';
  $('product-subtitle').hidden = !item.subtitle;
  $('product-price').textContent = formatPrice(item.price, CURRENCY);
  $('product-price').hidden = item.price == null;
  $('product-dims').textContent = `Ш × Г × В: ${dims(item)}`;
  $('product-description').textContent = item.description ?? '';
  $('option-label').textContent = item.option_label;
  viewer.setAttribute('ar-modes', AR_MODES);
  viewer.setAttribute('ar-placement', cat.arPlacement); // floor = любая горизонтальная поверхность, в т.ч. стол
  // Жёсткий масштаб 1:1 во всех режимах: WebXR — без щипка, Scene Viewer — resizable=false,
  // Quick Look — #allowsContentScaling=0 (всё это model-viewer делает по ar-scale="fixed").
  viewer.setAttribute('ar-scale', 'fixed');
  $('ar-prompt-text').textContent = `Поводите телефоном ${item.category === 'wall' ? 'перед' : 'над'} ${cat.surface}`;
  $('ar-placed-text').textContent = `${cat.placed} · перетащите, чтобы сдвинуть`;
  viewer.alt = `${item.name}: 3D-модель, ${dims(item)}`;

  $('swatches').innerHTML = item.variants.map((v) => `
    <label class="swatch" title="${esc(v.name)}">
      <input type="radio" name="variant" value="${esc(v.id)}" aria-label="${esc(v.name)}">
      <span style="background:${esc(v.swatch || '#ccc')}"></span>
    </label>`).join('');

  setVariant(variant);
  document.title = `${item.name} — примерка в AR`;
  updateArUi();
  prepareXR();
}

function setVariant(variant) {
  const item = state.item;
  state.variant = variant;
  $('variant-name').textContent = variant.name;
  const input = [...$('swatches').querySelectorAll('input')].find((i) => i.value === variant.id);
  if (input) input.checked = true;

  const src = modelUrl(item, variant);
  if (viewer.src !== src) {
    $('product-view').querySelector('.progress')?.classList.remove('done');
    viewer.src = src;
    viewer.cameraOrbit = '-25deg 75deg auto';
  }
  const url = new URL(location.href);
  url.searchParams.set('item', item.id);
  url.searchParams.set('v', variant.id);
  url.hash = '';
  history.replaceState(null, '', url);
  renderQr();
}

$('swatches').addEventListener('change', (e) => {
  const v = state.item?.variants.find((x) => x.id === e.target.value);
  if (v) setVariant(v);
});

// ---------- AR / QR / подсказки ----------
function showNotice(title, text) {
  $('notice-title').textContent = title;
  $('notice-text').textContent = text;
  $('notice').hidden = false;
}

async function updateArUi() {
  await customElements.whenDefined('model-viewer');
  const canAR = viewer.canActivateAR || xr.supported === true;
  $('notice').hidden = true;

  if (canAR) {
    $('ar-block').hidden = false;
    $('qr-block').hidden = true;
    $('ar-hint').textContent = state.item ? CATEGORIES[state.item.category].hint : '';
  } else if (!isMobile) {
    $('ar-block').hidden = true;
    $('qr-block').hidden = false;
  } else {
    $('ar-block').hidden = true;
    $('qr-block').hidden = true;
  }

  if (isMobile && isInApp) {
    showNotice('Откройте страницу в браузере',
      `Во встроенном браузере приложения AR может не запуститься. Нажмите «⋯» и выберите «Открыть в ${isIOS ? 'Safari' : 'Chrome'}».`);
  } else if (isMobile && !canAR) {
    showNotice('AR недоступен на этом устройстве', unsupportedText() + ' 3D-просмотр выше работает как обычно.');
  }
  if (state.sceneViewerFailed) {
    showNotice('Приложение Google для AR не открылось',
      'Нажмите «Посмотреть в комнате» ещё раз — AR откроется прямо в браузере. Чтобы работал основной режим, обновите приложение Google и «Сервисы Google Play для AR».');
  } else if (state.arFailed) {
    showNotice('Не получилось запустить AR', failedText());
  }
}

// Scene Viewer при ошибке возвращает на страницу с хешем #model-viewer-no-ar-fallback.
// model-viewer сам убирает хеш и при следующем нажатии использует WebXR — сообщаем об этом.
window.addEventListener('hashchange', () => {
  if (location.hash === '#model-viewer-no-ar-fallback') {
    state.sceneViewerFailed = true;
    dlog('Scene Viewer не открылся (вернулся #model-viewer-no-ar-fallback), следующий — другой режим');
    updateArUi();
  }
});

function unsupportedText() {
  if (isIOS) return 'Нужен iPhone или iPad с iOS 12 или новее, страница должна быть открыта в Safari.';
  if (isAndroid) return 'Нужен телефон с поддержкой ARCore («Сервисы Google Play для AR») и браузер Chrome.';
  return 'Откройте страницу на iPhone (Safari) или Android-телефоне (Chrome).';
}
function failedText() {
  if (isAndroid) return 'Проверьте, что установлены «Сервисы Google Play для AR», и попробуйте ещё раз. 3D-просмотр работает.';
  return 'Попробуйте ещё раз или откройте страницу в Safari. 3D-просмотр работает.';
}

$('ar-button').addEventListener('click', () => {
  // И requestSession(), и activateAR() должны вызываться синхронно из обработчика нажатия.
  state.arFailed = false;
  state.sceneViewerFailed = false;
  const path = arPath();
  state.lastPath = path;
  dlog(`нажатие → ${path}`);
  if (xr.mod && xr.supported && !xr.failed) {
    xr.mod.startAR({
      url: modelUrl(state.item, state.variant),
      placement: state.item.category,
      overlay: $('xr-overlay'),
      debugEl: DEBUG ? $('xr-debug') : null,
      log: dlog,
      onEnd: () => updateArUi(),
    }).catch((e) => {
      // Сессия не открылась вовсе → дальше пробуем режимы model-viewer. Ошибка уже внутри
      // открытой сессии (например, модель не загрузилась) → свой режим оставляем, можно повторить.
      if (!e.sessionStarted) xr.failed = true;
      dlog(`свой WebXR: ${e.sessionStarted ? 'ошибка в сессии' : 'сессия не открылась'} — ${e.name}: ${e.message}`);
      showNotice('AR в браузере не открылся',
        'Нажмите «Посмотреть в комнате» ещё раз — попробуем другой режим. 3D-просмотр работает.');
    });
    return;
  }
  viewer.activateAR();
});

viewer.addEventListener('ar-status', (e) => {
  dlog(`model-viewer ar-status: ${e.detail.status}`);
  if (e.detail.status === 'failed') { state.arFailed = true; updateArUi(); }
});
viewer.addEventListener('ar-tracking', (e) => dlog(`model-viewer ar-tracking: ${e.detail.status}`));
viewer.addEventListener('load', () => {
  $('product-view').querySelector('.progress').classList.add('done');
  updateArUi();
});
viewer.addEventListener('progress', (e) => {
  const p = e.detail.totalProgress;
  const bar = $('product-view').querySelector('.progress');
  bar.querySelector('.progress-fill').style.width = `${Math.round(p * 100)}%`;
  bar.classList.toggle('done', p >= 1);
});

function renderQr() {
  if ($('qr-block').hidden && isMobile) return;
  if (typeof qrcode !== 'function') { window.addEventListener('load', renderQr, { once: true }); return; }
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('item', state.item.id);
  url.searchParams.set('v', state.variant.id);
  if (DEBUG) url.searchParams.set('debug', '1');
  const qr = qrcode(0, 'M');
  qr.addData(url.href);
  qr.make();
  $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  $('qr-local').hidden = !isLocal;
}

// ---------- Маршрутизация (?item=…&v=…) ----------
function route() {
  const params = new URLSearchParams(location.search);
  const item = CATALOG.find((x) => x.id === params.get('item'));
  // Scene Viewer при неудаче возвращает на страницу с этим хешем.
  if (location.hash === '#model-viewer-no-ar-fallback') state.sceneViewerFailed = true;

  $('catalog-view').hidden = Boolean(item);
  $('product-view').hidden = !item;
  if (item) {
    const variant = item.variants.find((v) => v.id === params.get('v')) ?? item.variants[0];
    showProduct(item, variant);
  } else {
    state.item = null;
    document.title = 'Примерка мебели в AR';
  }
  window.scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-item], a[data-nav="catalog"]');
  if (!link || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  const next = new URLSearchParams();
  if (link.dataset.item) next.set('item', link.dataset.item);
  if (DEBUG) next.set('debug', '1');
  history.pushState(null, '', next.size ? `?${next}` : location.pathname);
  route();
});
window.addEventListener('popstate', route);

try {
  ({ items: CATALOG, currency: CURRENCY } = await loadCatalog());
} catch (e) {
  $('catalog-grid').innerHTML = `<li class="load-error">Не удалось загрузить каталог (${esc(e.message)}). Обновите страницу.</li>`;
  dlog(`catalog.json: ${e.message}`);
}
renderFilters();
renderCatalog();
route();
if (DEBUG) {
  $('ar-block').after($('debug-panel')); // сразу под кнопкой AR — удобно для скриншота
  updateDebug();
  setInterval(updateDebug, 1000);
}
