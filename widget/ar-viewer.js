/*! AR-примерка: виджет для сайта магазина · https://github.com/ViachKovDesign/ar-primerka
 *
 * Подключение:
 *   <script src="https://viachkovdesign.github.io/ar-primerka/widget/ar-viewer.js" defer></script>
 *   <div data-ar-item="divan-izognutyy"></div>
 *
 * Атрибуты элемента: data-ar-item (id товара из catalog.json, обязательно), data-ar-variant (id варианта),
 * data-ar-label (текст кнопки), data-ar-catalog (свой адрес catalog.json).
 * Атрибут тега <script>: data-catalog (свой адрес catalog.json для всех кнопок).
 * Цвета кнопки: CSS-переменные --ar-button-bg, --ar-button-color, --ar-button-radius, --ar-font.
 *
 * Что делает: рисует кнопку (Shadow DOM — стили сайта и виджета не пересекаются). По нажатию открывает
 * окно с 3D-просмотром и только тогда грузит model-viewer (widget/engine/). Android — собственный WebXR,
 * запасные WebXR model-viewer и Scene Viewer; iPhone — Quick Look; компьютер — 3D + QR-код для телефона.
 * Без трекеров, cookie и сторонних запросов: всё грузится с того же адреса, откуда сам виджет.
 */
(() => {
  'use strict';
  if (window.ARPrimerka) return; // виджет подключили дважды

  const VERSION = '1.0.0';
  const script = document.currentScript
    || [...document.scripts].find((s) => /\/ar-viewer(\.min)?\.js(\?|$)/.test(s.src));
  const BASE = new URL('.', script?.src || location.href);
  const ENGINE = new URL('engine/', BASE);
  const DEFAULT_CATALOG = new URL(script?.dataset.catalog || '../catalog.json', BASE).href;
  const LOG = '[AR-примерка]';
  // ?ar-debug=1 в адресе страницы: подробный журнал AR в консоль (для проверки на телефоне).
  const DEBUG = /[?&]ar-debug(=|&|$)/.test(location.search);
  const dlog = DEBUG ? (msg) => console.info(LOG, msg) : () => {};

  // ---------- Устройство (как в демо, js/app.js) ----------
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const isMobile = Boolean(navigator.userAgentData?.mobile) || isIOS || isAndroid
    || matchMedia('(hover: none) and (pointer: coarse)').matches;
  const isInApp = /FBAN|FBAV|Instagram|Telegram|VKClient|OKApp|Line\/|MicroMessenger|; wv\)/i.test(ua);
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || location.protocol === 'file:';

  const CATEGORIES = {
    floor: { placement: 'floor', hint: 'Наведите камеру на пол и медленно поводите телефоном: появится кольцо. Коснитесь экрана — предмет встанет в реальном размере.' },
    table: { placement: 'floor', hint: 'Наведите камеру на стол и медленно поводите телефоном: на столешнице появится кольцо. Коснитесь экрана — предмет встанет на стол.' },
    wall: { placement: 'wall', hint: 'Наведите камеру на стену и медленно поводите телефоном: появится кольцо. Коснитесь экрана — предмет повиснет на стене.' },
  };
  const AR_MODES = 'webxr scene-viewer quick-look';
  const BG = new Set(['light', 'dark', 'mid']);

  // ---------- Каталог ----------
  const catalogs = new Map(); // адрес → Promise<{ items }>
  function getCatalog(url) {
    if (!catalogs.has(url)) {
      const p = fetch(url, { credentials: 'omit' }).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      }).then((data) => ({
        items: (data.items ?? []).filter((it) => it.id && Array.isArray(it.variants) && it.variants.length
          && it.variants.every((v) => v.id && v.model)).map((it) => ({
          ...it,
          category: CATEGORIES[it.category] ? it.category : 'floor',
          option_label: it.option_label || 'Вариант',
          variants: it.variants.map((v) => ({ ...v, modelUrl: new URL(v.model, url).href })),
          posterUrl: it.poster ? new URL(it.poster, url).href : '',
        })),
      }));
      p.catch((e) => console.warn(LOG, `не удалось загрузить каталог ${url}: ${e.message}. ` +
        'Проверьте адрес и что сервер отдаёт заголовок Access-Control-Allow-Origin.'));
      catalogs.set(url, p);
    }
    return catalogs.get(url);
  }

  // ---------- Ленивая загрузка движка ----------
  let mvPromise = null;
  function loadModelViewer() {
    if (customElements.get('model-viewer')) return Promise.resolve();
    mvPromise ||= import(new URL('mv.js', ENGINE).href)
      .then(() => customElements.whenDefined('model-viewer'))
      .catch((e) => { mvPromise = null; throw e; });
    return mvPromise;
  }
  const xr = { mod: null, supported: null, failed: false, loading: null };
  function prepareXR() {
    if (!isMobile || isIOS || !navigator.xr || !window.isSecureContext) { xr.supported = false; return Promise.resolve(); }
    xr.loading ||= import(new URL('xr.js', ENGINE).href).then(async (mod) => {
      xr.supported = await mod.isSupported();
      xr.mod = mod;
    }).catch((e) => { xr.supported = false; console.warn(LOG, 'WebXR-модуль не загрузился:', e.message); });
    return xr.loading;
  }

  // ---------- Общие куски разметки ----------
  const ICON_AR = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM12 12l8-4.5M12 12v9M12 12L4 7.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  const ICON_CLOSE = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  const ICON_PHONE = '<svg class="phone" viewBox="0 0 48 48" width="56" height="56" aria-hidden="true"><rect x="15" y="6" width="18" height="32" rx="3" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M6 42h36" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="3 4"/></svg>';
  const FONT = 'var(--ar-font, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif)';

  // Хост-элемент: inline-стили с !important перебивают правила сайта вида `div { … }`.
  function harden(host, display) {
    for (const [k, v] of Object.entries({ display, margin: '0', padding: '0', border: '0', float: 'none', visibility: 'visible', opacity: '1', transform: 'none' })) {
      host.style.setProperty(k, v, 'important');
    }
  }

  // ---------- Кнопка ----------
  const BUTTON_CSS = `
    :host { all: initial; display: inline-block; }
    /* all: initial, а не unset: иначе через хост наследуются шрифт, регистр, разрядка и т. п. со страницы */
    button { all: initial; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 10px;
      min-height: 48px; padding: 0 22px; border-radius: var(--ar-button-radius, 14px);
      background: var(--ar-button-bg, #22201d); color: var(--ar-button-color, #fff);
      font: 600 16px/1.2 ${FONT}; letter-spacing: normal; text-transform: none; white-space: nowrap;
      cursor: pointer; -webkit-tap-highlight-color: transparent; transition: opacity .15s, transform .1s; }
    button:hover { opacity: .9; }
    button:active { transform: scale(.98); }
    button:focus-visible { outline: 2px solid var(--ar-button-bg, #22201d); outline-offset: 3px; }
    svg { flex: none; display: block; }
    @media (prefers-reduced-motion: reduce) { button { transition: none; } }`;

  const mounted = new WeakSet();
  function mount(el) {
    if (mounted.has(el)) return;
    mounted.add(el);
    const id = (el.getAttribute('data-ar-item') || '').trim();
    const catalogUrl = el.dataset.arCatalog ? new URL(el.dataset.arCatalog, location.href).href : DEFAULT_CATALOG;
    const host = document.createElement('ar-primerka-button');
    harden(host, 'none'); // покажем, когда убедимся, что товар есть в каталоге
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${BUTTON_CSS}</style><button type="button" part="button">${ICON_AR}<span></span></button>`;
    const button = root.querySelector('button');
    button.querySelector('span').textContent = el.dataset.arLabel || 'Посмотреть в комнате';
    el.appendChild(host);

    getCatalog(catalogUrl).then(({ items }) => {
      const item = items.find((it) => it.id === id);
      if (!item) {
        console.warn(LOG, `товара «${id}» нет в каталоге ${catalogUrl}. Есть: ${items.map((it) => it.id).join(', ')}`);
        return;
      }
      harden(host, 'inline-block');
      button.addEventListener('click', () => open({ item, catalogUrl, variantId: el.getAttribute('data-ar-variant'), trigger: button }));
    }, () => {});
  }

  function scan(root = document) {
    if (root.matches?.('[data-ar-item]')) mount(root);
    root.querySelectorAll?.('[data-ar-item]').forEach(mount);
  }

  // ---------- Окно просмотра ----------
  const MODAL_CSS = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .wrap { all: initial; position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
      font: 400 15px/1.45 ${FONT}; color: #22201d; -webkit-text-size-adjust: 100%; }
    .backdrop { position: absolute; inset: 0; background: rgb(20 19 17 / .55); }
    .dialog { position: relative; display: grid; grid-template-rows: auto 1fr; width: 100%; height: 100%;
      background: #faf8f4; overflow: hidden; }
    .close { position: absolute; z-index: 3; top: max(10px, env(safe-area-inset-top)); right: 10px; width: 44px; height: 44px;
      display: grid; place-items: center; border: 0; border-radius: 50%; padding: 0; cursor: pointer;
      background: rgb(255 255 255 / .92); color: #22201d; box-shadow: 0 2px 10px rgb(0 0 0 / .15); }
    .close:focus-visible, .btn-ar:focus-visible { outline: 2px solid #2f5d50; outline-offset: 3px; }

    .stage { position: relative; height: 52dvh; min-height: 260px;
      --top: #d2d2d0; --bottom: #9b9b99; --floor: rgb(255 255 255 / .32);
      background: radial-gradient(ellipse 62% 20% at 50% 88%, var(--floor), transparent 75%),
        linear-gradient(180deg, var(--top) 0%, var(--bottom) 100%); }
    .stage[data-bg="dark"] { --top: #8a8c8f; --bottom: #545659; --floor: rgb(255 255 255 / .26); }
    .stage[data-bg="light"] { --top: #f3f3f1; --bottom: #c6c6c4; --floor: rgb(255 255 255 / .6); }
    .pre { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
    model-viewer { position: absolute; inset: 0; width: 100%; height: 100%; display: block;
      background: transparent; --poster-color: transparent; }
    .loading { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); display: flex; align-items: center; gap: 8px;
      padding: 8px 14px; border-radius: 999px; background: rgb(255 255 255 / .85); font-size: 14px; white-space: nowrap; }
    .spinner { width: 16px; height: 16px; border-radius: 50%; border: 2px solid rgb(34 32 29 / .2); border-top-color: #22201d; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .progress { position: absolute; left: 16px; right: 16px; bottom: 12px; height: 3px; border-radius: 3px; background: rgb(34 32 29 / .1); overflow: hidden; transition: opacity .3s; }
    .progress.done { opacity: 0; }
    .progress-fill { height: 100%; width: 0; background: #22201d; transition: width .15s; }
    .stage[data-bg="dark"] .progress-fill { background: #fff; }
    .model-error { position: absolute; inset: 0; z-index: 2; display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 6px; padding: 24px; text-align: center; background: rgb(255 255 255 / .85); font-size: 14px; }
    .model-error strong { font-size: 17px; }
    .model-error span { color: #6d675f; max-width: 34ch; overflow-wrap: anywhere; }
    .hint { position: absolute; left: 0; right: 0; bottom: 22px; margin: 0; text-align: center; font-size: 13px; color: rgb(34 32 29 / .7); pointer-events: none; }
    .stage[data-bg="dark"] .hint { color: rgb(255 255 255 / .8); }

    .details { display: grid; gap: 14px; align-content: start; padding: 18px 16px max(20px, env(safe-area-inset-bottom)); overflow: auto; }
    h2 { margin: 0; font-size: 22px; line-height: 1.2; font-weight: 650; }
    .dims { justify-self: start; margin: 0; font-size: 14px; font-variant-numeric: tabular-nums; padding: 6px 10px; border-radius: 999px; background: #fff; border: 1px solid #e4ded4; }
    fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
    legend { padding: 0; margin-bottom: 10px; color: #6d675f; font-size: 15px; }
    legend strong { color: #22201d; font-weight: 600; }
    .swatches { display: flex; flex-wrap: wrap; gap: 12px; }
    .swatch { position: relative; display: block; }
    .swatch input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; width: 100%; height: 100%; }
    .swatch span { display: block; width: 44px; height: 44px; border-radius: 50%; border: 1px solid rgb(0 0 0 / .14);
      box-shadow: 0 0 0 3px #faf8f4, 0 0 0 4px transparent; transition: box-shadow .15s; }
    .swatch input:checked + span { box-shadow: 0 0 0 3px #faf8f4, 0 0 0 5px #22201d; }
    .swatch input:focus-visible + span { outline: 2px solid #2f5d50; outline-offset: 6px; }
    .ar-block { display: grid; gap: 10px; }
    .btn-ar { display: inline-flex; align-items: center; justify-content: center; gap: 10px; width: 100%; min-height: 56px; padding: 0 20px;
      border: 0; border-radius: 14px; background: #22201d; color: #fff; font: inherit; font-weight: 600; font-size: 17px; cursor: pointer; }
    .btn-ar:active { transform: scale(.98); }
    .ar-hint, .qr-block p, .credit { margin: 0; color: #6d675f; font-size: 14px; }
    .qr-block { display: grid; grid-template-columns: 120px 1fr; gap: 16px; align-items: center; padding: 14px; background: #fff; border: 1px solid #e4ded4; border-radius: 16px; }
    .qr { background: #fff; line-height: 0; aspect-ratio: 1; }
    .qr svg { width: 100%; height: auto; }
    h3 { margin: 0 0 6px; font-size: 17px; font-weight: 650; }
    .qr-local { margin-top: 8px !important; color: #6b4a1a !important; }
    .notice { padding: 12px 14px; border-radius: 14px; background: #fbf3e6; color: #6b4a1a; font-size: 14px; }
    .notice strong { display: block; margin-bottom: 2px; color: #4a3311; }
    .notice p { margin: 0; }
    .credit { font-size: 12px; }
    .credit a { color: inherit; text-decoration: underline; }

    @media (min-width: 760px) and (min-height: 480px) {
      .dialog { width: min(980px, calc(100vw - 48px)); height: min(640px, calc(100dvh - 48px)); border-radius: 20px;
        grid-template-rows: none; grid-template-columns: 1.35fr 1fr; box-shadow: 0 24px 60px rgb(0 0 0 / .3); }
      .stage { height: auto; }
      .details { padding: 64px 24px 24px; }
      .close { top: 12px; right: 12px; }
    }

    /* Подсказки model-viewer в его WebXR (запасной режим) */
    .ar-prompt, .ar-chip { display: none; position: absolute; left: 50%; transform: translateX(-50%); z-index: 10; pointer-events: none;
      background: rgb(20 19 17 / .72); color: #fff; font-weight: 600; text-align: center; }
    .ar-prompt { bottom: 96px; flex-direction: column; align-items: center; gap: 10px; padding: 16px 20px; border-radius: 18px; width: max-content; max-width: calc(100% - 32px); font-size: 17px; }
    .ar-chip { top: max(20px, env(safe-area-inset-top)); align-items: center; gap: 8px; padding: 10px 16px; border-radius: 999px; font-size: 15px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: #4cd964; flex: none; }
    model-viewer[ar-status="session-started"] .ar-prompt { display: flex; }
    model-viewer[ar-status="object-placed"]:not([ar-tracking="not-tracking"]) .ar-chip-placed { display: flex; animation: fade 5s forwards; }
    @keyframes fade { 0%, 80% { opacity: 1; } 100% { opacity: 0; } }
    .phone { animation: sweep 2.2s ease-in-out infinite; }
    @keyframes sweep { 0%, 100% { transform: translateX(-22px) rotate(-8deg); } 50% { transform: translateX(22px) rotate(8deg); } }

    /* Собственный WebXR-оверлей (Android), разметка и состояния — как в демо */
    .xr-overlay { position: fixed; inset: 0; z-index: 10; color: #fff; font: 600 16px/1.35 ${FONT}; pointer-events: none; }
    .xr-drag { position: absolute; inset: 0; pointer-events: auto; touch-action: none; }
    .xr-top { position: absolute; top: max(16px, env(safe-area-inset-top)); left: 16px; right: 16px; display: flex; justify-content: flex-end; }
    .xr-center { position: absolute; left: 16px; right: 16px; bottom: 34%; display: flex; justify-content: center; }
    .xr-bottom { position: absolute; left: 16px; right: 16px; bottom: max(28px, calc(env(safe-area-inset-bottom) + 20px)); display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .xr-msg { display: none; align-items: center; gap: 10px; text-align: center; padding: 12px 18px; border-radius: 16px; max-width: 100%; background: rgb(20 19 17 / .72); }
    .xr-msg-big { flex-direction: column; font-size: 18px; padding: 18px 22px; }
    .xr-msg-warn { background: rgb(160 60 30 / .85); }
    .xr-btn { pointer-events: auto; border: 0; font: inherit; color: #22201d; background: rgb(255 255 255 / .94); min-height: 48px; padding: 0 22px; border-radius: 999px; box-shadow: 0 4px 16px rgb(0 0 0 / .25); }
    .xr-close { width: 48px; padding: 0; display: grid; place-items: center; }
    .xr-reset { display: none; }
    .xr-spinner { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid rgb(255 255 255 / .35); border-top-color: #fff; animation: spin .8s linear infinite; }
    .xr-overlay[data-state="loading"] [data-for="loading"], .xr-overlay[data-state="searching"] [data-for="searching"],
    .xr-overlay[data-state="lost"] [data-for="lost"], .xr-overlay[data-state="ready"] [data-for="ready"],
    .xr-overlay[data-state="placed"] .xr-msg[data-for="placed"] { display: flex; }
    .xr-overlay[data-state="placed"] .xr-reset { display: inline-block; }
    .xr-debug { display: none; }
    @media (prefers-reduced-motion: reduce) { .phone, .spinner, .xr-spinner { animation: none; } .progress, .progress-fill, .swatch span { transition: none; } }`;

  const MODAL_HTML = `
    <div class="wrap" part="modal">
      <div class="backdrop"></div>
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="title">
        <button type="button" class="close" aria-label="Закрыть">${ICON_CLOSE}</button>
        <div class="stage">
          <img class="pre" alt="" decoding="async">
          <model-viewer camera-controls touch-action="pan-y" shadow-intensity="1" shadow-softness="0.6" exposure="1.05"
            environment-image="neutral" interaction-prompt="auto" camera-orbit="-25deg 75deg auto"
            ar ar-modes="${AR_MODES}" ar-scale="fixed" ar-placement="floor" loading="eager" ar-usdz-max-texture-size="2048">
            <span slot="ar-button" hidden></span>
            <div slot="progress-bar" class="progress" aria-hidden="true"><div class="progress-fill"></div></div>
            <div class="ar-prompt" role="status">${ICON_PHONE}<span>Поводите телефоном над полом</span></div>
            <div class="ar-chip ar-chip-placed" role="status"><span class="dot"></span><span>Стоит · перетащите, чтобы сдвинуть</span></div>
          </model-viewer>
          <div class="loading" role="status"><span class="spinner"></span><span>Загружаем 3D…</span></div>
          <p class="hint" hidden aria-hidden="true">Вращайте, приближайте щипком</p>
          <div class="model-error" role="alert" hidden><strong></strong><span></span></div>
        </div>
        <div class="details">
          <h2 id="title"></h2>
          <p class="dims"></p>
          <fieldset><legend><span class="opt"></span>: <strong class="vname"></strong></legend><div class="swatches"></div></fieldset>
          <div class="ar-block" hidden>
            <button type="button" class="btn-ar">${ICON_AR}Поставить в комнате</button>
            <p class="ar-hint"></p>
          </div>
          <div class="qr-block" hidden>
            <div class="qr" role="img" aria-label="QR-код: эта страница на телефоне"></div>
            <div>
              <h3>Откройте на телефоне</h3>
              <p>Наведите камеру телефона на код — откроется этот товар и цвет. Там его можно поставить в комнате.</p>
              <p class="qr-local" hidden>Страница открыта локально: с телефона этот адрес не откроется.</p>
            </div>
          </div>
          <div class="notice" role="status" hidden><strong></strong><p></p></div>
          <p class="credit" hidden></p>
        </div>
      </div>
      <div class="xr-overlay" hidden data-state="loading">
        <div class="xr-drag" aria-hidden="true"></div>
        <div class="xr-top"><pre class="xr-debug"></pre><button type="button" id="xr-close" class="xr-btn xr-close" aria-label="Закрыть AR">${ICON_CLOSE}</button></div>
        <div class="xr-center" role="status" aria-live="polite">
          <div class="xr-msg" data-for="loading"><span class="xr-spinner"></span>Загружаем модель…</div>
          <div class="xr-msg xr-msg-big" data-for="searching">${ICON_PHONE}<span class="xr-search-text">Поводите телефоном над полом</span></div>
          <div class="xr-msg xr-msg-warn" data-for="lost">Поверхность потеряна — медленно поводите телефоном</div>
          <div class="xr-msg" data-for="ready"><span>Кольцо — где встанет предмет.<br><strong>Коснитесь экрана, чтобы поставить</strong></span></div>
        </div>
        <div class="xr-bottom">
          <div class="xr-msg" data-for="placed"><span class="dot"></span><span><span class="xr-placed-text">Стоит на полу</span><span class="xr-rotate-hint"> · проведите пальцем, чтобы повернуть</span></span></div>
          <button type="button" id="xr-reset" class="xr-btn xr-reset" data-for="placed">Переставить</button>
        </div>
      </div>
    </div>`;

  let M = null; // окно создаётся один раз, при первом открытии
  const S = { item: null, variant: null, catalogUrl: '', trigger: null, modelError: false, arFailed: false, svFailed: false, msg: null, prevOverflow: '' };

  function buildModal() {
    const host = document.createElement('ar-primerka-modal');
    harden(host, 'none');
    for (const [k, v] of Object.entries({ position: 'fixed', inset: '0', 'z-index': '2147483000' })) host.style.setProperty(k, v, 'important');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${MODAL_CSS}</style>${MODAL_HTML}`;
    document.body.appendChild(host);
    const q = (s) => root.querySelector(s);
    M = { host, root, q, mv: q('model-viewer'), stage: q('.stage'), dialog: q('.dialog'), overlay: q('.xr-overlay') };

    q('.close').addEventListener('click', close);
    q('.backdrop').addEventListener('click', close);
    root.addEventListener('keydown', onKeydown);
    q('.swatches').addEventListener('change', (e) => {
      const v = S.item?.variants.find((x) => x.id === e.target.value);
      if (v) setVariant(v);
    });
    q('.btn-ar').addEventListener('click', startAR);

    const mv = M.mv;
    mv.addEventListener('load', () => {
      S.modelError = false;
      q('.model-error').hidden = true;
      q('.pre').hidden = true;
      q('.loading').hidden = true;
      q('.progress').classList.add('done');
      q('.hint').hidden = isMobile; // на телефоне подсказку показывает сам model-viewer (рука)
      updateArUi();
    });
    mv.addEventListener('progress', (e) => {
      const p = e.detail.totalProgress;
      q('.progress-fill').style.width = `${Math.round(p * 100)}%`;
      q('.progress').classList.toggle('done', p >= 1);
    });
    mv.addEventListener('error', async (e) => {
      if (e.detail?.type !== 'loadfailure') return;
      const src = mv.src;
      let notFound = false;
      try { notFound = (await fetch(src, { method: 'HEAD', cache: 'no-store', credentials: 'omit' })).status === 404; } catch { /* сеть или CORS */ }
      if (mv.src !== src) return;
      showModelError(notFound ? 'Файл модели не найден' : 'Модель не загрузилась',
        notFound ? `Нет файла ${new URL(src).pathname.split('/').slice(-2).join('/')}. Сообщите, пожалуйста, магазину.` : 'Проверьте интернет и попробуйте ещё раз.');
    });
    mv.addEventListener('ar-status', (e) => {
      dlog(`model-viewer ar-status: ${e.detail.status}`);
      if (e.detail.status === 'failed') { S.arFailed = true; updateArUi(); }
    });
  }

  function showModelError(title, text) {
    S.modelError = true;
    M.q('.model-error strong').textContent = title;
    M.q('.model-error span').textContent = text;
    M.q('.model-error').hidden = false;
    M.q('.loading').hidden = true;
    M.q('.progress').classList.add('done');
    M.q('.ar-block').hidden = true;
  }

  function onKeydown(e) {
    if (e.key === 'Escape' && M.overlay.hidden) { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    // Фокус не уходит из окна на страницу магазина.
    const list = [...M.dialog.querySelectorAll('button, input:checked, [tabindex]:not([tabindex="-1"])')]
      .filter((n) => !n.closest('[hidden]') && !n.disabled);
    if (!list.length) return;
    const first = list[0], last = list[list.length - 1], cur = M.root.activeElement;
    if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
  }

  async function open({ item, catalogUrl, variantId, trigger = null }) {
    if (!document.body) return;
    if (!M) buildModal();
    S.item = item;
    S.catalogUrl = catalogUrl;
    S.trigger = trigger;
    S.arFailed = false;
    S.msg = null;
    const { q, mv } = M;
    const cat = CATEGORIES[item.category];

    q('#title').textContent = item.name || item.id;
    const { w, d, h } = item.size_cm ?? {};
    q('.dims').textContent = w ? `Ш × Г × В: ${w} × ${d} × ${h} см` : '';
    q('.dims').hidden = !w;
    q('.opt').textContent = item.option_label;
    q('fieldset').hidden = item.variants.length < 2;
    const box = q('.swatches');
    box.textContent = '';
    for (const v of item.variants) {
      const label = document.createElement('label');
      label.className = 'swatch';
      label.title = v.name || v.id;
      const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'arp-variant', value: v.id });
      input.setAttribute('aria-label', v.name || v.id);
      const dot = document.createElement('span');
      dot.style.background = v.swatch || '#ccc';
      label.append(input, dot);
      box.append(label);
    }
    q('.ar-hint').textContent = cat.hint;
    renderCredit(q('.credit'), item);
    mv.setAttribute('ar-placement', cat.placement);
    mv.setAttribute('ar-modes', S.svFailed ? 'webxr quick-look' : AR_MODES);
    mv.setAttribute('alt', `${item.name || item.id}: 3D-модель`); // атрибут, не свойство: элемент ещё не «оживлён»
    mv.removeAttribute('src');
    q('.pre').src = item.posterUrl || '';
    q('.pre').hidden = !item.posterUrl;
    q('.loading').hidden = false;
    q('.model-error').hidden = true;
    q('.hint').hidden = true;
    q('.notice').hidden = true;
    q('.ar-block').hidden = true;
    q('.qr-block').hidden = true;
    S.modelError = false;

    setVariant(item.variants.find((v) => v.id === variantId) ?? item.variants[0]);

    S.prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    harden(M.host, 'block');
    q('.close').focus({ preventScroll: true });

    prepareXR().then(updateArUi);
    try {
      await loadModelViewer();
    } catch (e) {
      console.warn(LOG, '3D-просмотр не загрузился:', e.message);
      showModelError('3D-просмотр не загрузился', 'Проверьте интернет и попробуйте ещё раз.');
      return;
    }
    updateArUi();
    if (!isMobile) renderQr();
  }

  // Указание автора (обязательно для моделей CC BY): поля credit, credit_url, credit_license_url в catalog.json.
  function renderCredit(el, item) {
    el.textContent = item.credit || '';
    el.hidden = !item.credit;
    for (const [url, text] of [[item.credit_url, 'источник'], [item.credit_license_url, 'лицензия']]) {
      if (!url) continue;
      const a = Object.assign(document.createElement('a'), { href: url, textContent: text, target: '_blank', rel: 'noopener' });
      el.append(' · ', a);
    }
  }

  function close() {
    if (!M || !M.overlay.hidden) return;
    harden(M.host, 'none');
    M.mv.removeAttribute('src'); // освобождаем память GPU
    document.documentElement.style.overflow = S.prevOverflow;
    S.trigger?.focus({ preventScroll: true });
  }

  function setVariant(v) {
    const { q, mv } = M;
    S.variant = v;
    q('.vname').textContent = v.name || v.id;
    const input = [...q('.swatches').querySelectorAll('input')].find((i) => i.value === v.id);
    if (input) input.checked = true;
    const bg = BG.has(v.bg) ? v.bg : BG.has(S.item.bg) ? S.item.bg : 'mid';
    if (bg !== 'mid') M.stage.dataset.bg = bg; else delete M.stage.dataset.bg;
    if (mv.getAttribute('src') !== v.modelUrl) {
      S.modelError = false;
      q('.model-error').hidden = true;
      q('.progress').classList.remove('done');
      mv.setAttribute('src', v.modelUrl);
      mv.setAttribute('camera-orbit', '-25deg 75deg auto');
      updateArUi();
    }
    if (!isMobile && !M.q('.qr-block').hidden) renderQr();
  }

  function showNotice(title, text) {
    M.q('.notice strong').textContent = title;
    M.q('.notice p').textContent = text;
    M.q('.notice').hidden = false;
  }

  function updateArUi() {
    if (!M || !S.item) return;
    const { q, mv } = M;
    const defined = Boolean(customElements.get('model-viewer'));
    const canAR = (defined && mv.canActivateAR) || xr.supported === true;
    const pending = isMobile && (!defined || (xr.supported === null && !isIOS));
    q('.ar-block').hidden = !isMobile || !canAR || S.modelError;
    q('.qr-block').hidden = isMobile || !defined;
    if (S.msg) {
      showNotice(...S.msg);
    } else if (S.svFailed || S.arFailed) {
      showNotice(S.svFailed ? 'Приложение Google для AR не открылось' : 'Не получилось запустить AR',
        S.svFailed ? 'Нажмите «Поставить в комнате» ещё раз — AR откроется прямо в браузере.'
          : isAndroid ? 'Проверьте, что установлены «Сервисы Google Play для AR», и попробуйте ещё раз. 3D-просмотр работает.'
            : 'Попробуйте ещё раз или откройте страницу в Safari. 3D-просмотр работает.');
    } else if (isMobile && isInApp) {
      showNotice('Откройте страницу в браузере',
        `Во встроенном браузере приложения AR может не запуститься. Нажмите «⋯» и выберите «Открыть в ${isIOS ? 'Safari' : 'Chrome'}».`);
    } else if (isMobile && !canAR && !pending) {
      showNotice('AR недоступен на этом устройстве',
        (isIOS ? 'Нужен iPhone или iPad с iOS 12 или новее, страница должна быть открыта в Safari.'
          : isAndroid ? 'Нужен телефон с поддержкой ARCore («Сервисы Google Play для AR») и браузер Chrome.'
            : 'Откройте страницу на iPhone (Safari) или Android-телефоне (Chrome).') + ' 3D-просмотр работает.');
    } else {
      q('.notice').hidden = true;
    }
  }

  // AR: и requestSession(), и activateAR() вызываются синхронно из обработчика нажатия.
  function startAR() {
    const { mv } = M;
    S.arFailed = false;
    S.msg = null;
    dlog(`нажатие AR: ${xr.mod && xr.supported && !xr.failed ? 'свой WebXR' : `model-viewer (${mv.getAttribute('ar-modes')}), canActivateAR=${mv.canActivateAR}`}; ` +
      `устройство: ${isIOS ? 'iOS' : isAndroid ? 'Android' : 'другое'}${isInApp ? ', встроенный браузер' : ''}; secure=${window.isSecureContext}, xr=${Boolean(navigator.xr)}, immersive-ar=${xr.supported}`);
    if (xr.mod && xr.supported && !xr.failed) {
      xr.mod.startAR({
        url: S.variant.modelUrl,
        placement: S.item.category,
        overlay: M.overlay,
        log: dlog,
        onEnd: () => updateArUi(),
      }).catch((e) => {
        if (!e.sessionStarted) xr.failed = true; // дальше — режимы model-viewer
        console.warn(LOG, 'WebXR:', e.message);
        S.msg = ['AR в браузере не открылся', 'Нажмите «Поставить в комнате» ещё раз — попробуем другой режим. 3D-просмотр работает.'];
        updateArUi();
      });
      return;
    }
    // Scene Viewer при ошибке перезагружает страницу с #model-viewer-no-ar-fallback — запомним товар,
    // чтобы снова открыть окно (только на время вкладки, sessionStorage; не cookie).
    if (isAndroid) {
      try { sessionStorage.setItem('ar-primerka-sv', JSON.stringify({ c: S.catalogUrl, i: S.item.id, v: S.variant.id })); } catch { /* приватный режим */ }
    }
    if (typeof mv.activateAR === 'function') mv.activateAR();
  }

  // QR на компьютере: эта же страница магазина + #ar-primerka=товар:вариант → на телефоне окно откроется само.
  let qrLib = null;
  async function renderQr() {
    try {
      qrLib ||= (await import(new URL('qr.js', ENGINE).href)).default;
    } catch (e) { console.warn(LOG, 'QR не загрузился:', e.message); M.q('.qr-block').hidden = true; return; }
    const url = new URL(location.href);
    url.hash = `ar-primerka=${encodeURIComponent(S.item.id)}:${encodeURIComponent(S.variant.id)}`;
    const qr = qrLib(0, 'M');
    qr.addData(url.href);
    qr.make();
    M.q('.qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    M.q('.qr-local').hidden = !isLocal;
  }

  // ---------- Открытие по ссылке из QR и возврат из Scene Viewer ----------
  async function openFromUrl() {
    const hash = location.hash;
    let req = null;
    const m = hash.match(/^#ar-primerka=([^:]+):?(.*)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const el = [...document.querySelectorAll('[data-ar-item]')].find((n) => n.getAttribute('data-ar-item').trim() === id);
      const c = el?.dataset.arCatalog ? new URL(el.dataset.arCatalog, location.href).href : DEFAULT_CATALOG;
      req = { c, i: id, v: decodeURIComponent(m[2] || '') };
    } else if (hash === '#model-viewer-no-ar-fallback') {
      try { req = JSON.parse(sessionStorage.getItem('ar-primerka-sv') || 'null'); sessionStorage.removeItem('ar-primerka-sv'); } catch { /* нет доступа */ }
      if (req) S.svFailed = true;
    }
    if (!req) return;
    history.replaceState(null, '', location.pathname + location.search);
    try {
      const { items } = await getCatalog(req.c);
      const item = items.find((it) => it.id === req.i);
      if (item) open({ item, catalogUrl: req.c, variantId: req.v });
    } catch { /* сообщение уже в консоли */ }
  }

  // ---------- Запуск ----------
  function init() {
    scan();
    // Кнопки, добавленные позже (Тильда, корзины, SPA), подхватываются сами.
    new MutationObserver((list) => {
      for (const r of list) for (const n of r.addedNodes) if (n.nodeType === 1) scan(n);
    }).observe(document.documentElement, { childList: true, subtree: true });
    openFromUrl();
  }

  window.ARPrimerka = {
    version: VERSION,
    scan,
    /** Открыть окно без кнопки: ARPrimerka.open('divan-izognutyy', 'navy') */
    async open(itemId, variantId, catalogUrl = DEFAULT_CATALOG) {
      const { items } = await getCatalog(catalogUrl);
      const item = items.find((it) => it.id === itemId);
      if (!item) throw new Error(`товара «${itemId}» нет в каталоге`);
      return open({ item, catalogUrl, variantId });
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
