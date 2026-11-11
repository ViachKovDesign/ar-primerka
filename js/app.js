import { CATALOG, modelUrl, posterUrl } from './catalog.js';

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

const state = { item: null, variant: null, arFailed: false };

// ---------- Каталог ----------
function renderCatalog() {
  $('catalog-grid').innerHTML = CATALOG.map((item) => `
    <li>
      <a class="card" href="?item=${item.id}" data-item="${item.id}">
        <div class="card-img">
          <img src="${posterUrl(item)}" alt="" width="400" height="400" loading="lazy" decoding="async">
        </div>
        <div class="card-body">
          <span class="card-title">${item.name}</span>
          <span class="card-meta">${dims(item)}</span>
          <span class="card-dots" aria-label="${item.variants.length} варианта">
            ${item.variants.map((v) => `<span class="dot" style="background:${v.swatch}"></span>`).join('')}
          </span>
        </div>
      </a>
    </li>`).join('');
}

const dims = ({ size: { w, d, h } }) => `${w} × ${d} × ${h} см`;

// ---------- Карточка ----------
function showProduct(item, variant) {
  state.item = item;
  $('product-title').textContent = item.name;
  $('product-subtitle').textContent = item.subtitle;
  $('product-dims').textContent = `Ш × Г × В: ${dims(item)}`;
  $('product-description').textContent = item.description;
  $('option-label').textContent = item.optionLabel;
  viewer.setAttribute('ar-modes', item.arModes);
  viewer.setAttribute('ar-placement', 'floor'); // floor = любая горизонтальная поверхность, в т.ч. стол
  viewer.alt = `${item.name}: 3D-модель, ${dims(item)}`;

  $('swatches').innerHTML = item.variants.map((v) => `
    <label class="swatch" title="${v.name}">
      <input type="radio" name="variant" value="${v.id}" aria-label="${v.name}">
      <span style="background:${v.swatch}"></span>
    </label>`).join('');

  setVariant(variant);
  document.title = `${item.name} — примерка в AR`;
  updateArUi();
}

function setVariant(variant) {
  const item = state.item;
  state.variant = variant;
  $('variant-name').textContent = variant.name;
  const input = $('swatches').querySelector(`input[value="${variant.id}"]`);
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
  const canAR = viewer.canActivateAR;
  $('notice').hidden = true;

  if (canAR) {
    $('ar-block').hidden = false;
    $('qr-block').hidden = true;
    $('ar-hint').textContent = state.item?.placeHint ?? '';
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
  if (state.arFailed) {
    showNotice('Не получилось запустить AR', failedText());
  }
}

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
  // activateAR() должен вызываться синхронно из обработчика нажатия.
  state.arFailed = false;
  viewer.activateAR();
});

viewer.addEventListener('ar-status', (e) => {
  if (e.detail.status === 'failed') { state.arFailed = true; updateArUi(); }
});
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
  if (location.hash === '#model-viewer-no-ar-fallback') state.arFailed = true;

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
  history.pushState(null, '', link.dataset.item ? `?item=${link.dataset.item}` : location.pathname);
  route();
});
window.addEventListener('popstate', route);

renderCatalog();
route();
