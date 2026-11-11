// Собственный WebXR-режим для Android (Chrome).
// Основа — официальный пример three.js «webxr_ar_hittest» (MIT): кольцо-указатель по hit-test
// и постановка по касанию. Дописано:
//  • принимаются только ГОРИЗОНТАЛЬНЫЕ поверхности (нормаль вверх), предмет всегда стоит ровно —
//    наклон поверхности игнорируется, поэтому торшер не «косит»;
//  • предмет появляется только после касания, затем фиксируется (WebXR Anchors, если есть),
//    и больше не следует за hit-test — поэтому не «уплывает»;
//  • масштаб строго 1:1 (модель в метрах, масштабирования нет вообще);
//  • кольцо размером с основание предмета + полупрозрачный «след» — видно, сколько места займёт;
//  • контактная тень, поворот одним пальцем, «Переставить», подсказки и отладка.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const UP_MIN = 0.85;            // cos ~32°: всё, что круче, — не пол/не столешница
const WALL_MAX = 0.3;           // |up.y| меньше — вертикальная поверхность (стена)
const LOST_AFTER_MS = 1200;     // столько без попаданий — «поверхность потеряна»
const SMOOTH = 0.35;            // сглаживание движения кольца (меньше — плавнее)

export async function isSupported() {
  try { return Boolean(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); }
  catch { return false; }
}

let renderer = null;
let busy = false;

/**
 * Запускает AR. ВАЖНО: вызывать синхронно из обработчика нажатия —
 * requestSession() требует жеста пользователя, поэтому он вызывается до любых await.
 * @returns {Promise<void>} резолвится при старте сессии; reject — если сессия не открылась.
 */
export function startAR(opts) {
  if (busy) return Promise.reject(new Error('AR уже запущен'));
  const { overlay } = opts;
  overlay.hidden = false;
  setState(overlay, 'loading');
  let sessionPromise;
  try {
    sessionPromise = navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'anchors'],
      domOverlay: { root: overlay },
    });
  } catch (e) {
    overlay.hidden = true;
    return Promise.reject(e);
  }
  busy = true;
  return run(sessionPromise, opts).catch((e) => { busy = false; overlay.hidden = true; throw e; });
}

function setState(overlay, s) {
  if (overlay.dataset.state !== s) overlay.dataset.state = s;
}

async function run(sessionPromise, { url, placement = 'floor', overlay, debugEl, log = () => {}, onEnd = () => {} }) {
  const session = await sessionPromise;
  log(`сессия открыта; функции: ${[...(session.enabledFeatures ?? [])].join(', ') || 'н/д'}`);
  // Страховка: если сессию закроют (кнопка «Назад») ещё во время загрузки — убрать оверлей.
  session.addEventListener('end', () => { overlay.hidden = true; busy = false; }, { once: true });
  try {
    await setup(session, { url, placement, overlay, debugEl, log, onEnd });
  } catch (e) {
    log(`ошибка: ${e.message}`);
    e.sessionStarted = true;
    try { await session.end(); } catch { /* уже закрыта */ }
    throw e;
  }
}

async function setup(session, { url, placement, overlay, debugEl, log, onEnd }) {

  // ---------- Рендерер и сцена ----------
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.NeutralToneMapping;
  }
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 30);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8d8a85, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);
  const refSpace = renderer.xr.getReferenceSpace();

  // ---------- Модель (масштаб 1:1, опора — низ модели) ----------
  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const wall = placement === 'wall';
  // Опора: пол/стол — центр низа; стена — центр задней плоскости (задняя грань к стене).
  if (wall) model.position.set(-center.x, -center.y, -box.min.z);
  else model.position.set(-center.x, -box.min.y, -center.z);
  const footR = Math.max(0.08, wall ? Math.hypot(size.x, size.y) / 2 : Math.hypot(size.x, size.z) / 2);
  log(`модель ${(size.x * 100).toFixed(0)}×${(size.z * 100).toFixed(0)}×${(size.y * 100).toFixed(0)} см`);

  const root = new THREE.Group();
  root.add(model);
  root.visible = false;
  scene.add(root);

  // Контактная тень: прозрачная плоскость, которая видна только там, где тень.
  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(footR * 4, footR * 4).rotateX(-Math.PI / 2),
    new THREE.ShadowMaterial({ opacity: 0.38 }),
  );
  shadowPlane.position.y = 0.001;
  if (wall) { shadowPlane.rotation.x = Math.PI / 2; shadowPlane.position.set(0, 0, 0.001); }
  shadowPlane.receiveShadow = true;
  root.add(shadowPlane);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -footR * 2; sc.right = sc.top = footR * 2; sc.near = 0.1; sc.far = size.y + 6;
  sc.updateProjectionMatrix();

  // ---------- Кольцо-указатель размером с основание ----------
  const reticle = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
  const ring = new THREE.Mesh(new THREE.RingGeometry(footR - 0.012, footR, 64).rotateX(-Math.PI / 2), ringMat);
  const fill = new THREE.Mesh(new THREE.CircleGeometry(footR, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false }));
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.015, 24).rotateX(-Math.PI / 2), ringMat);
  // Стрелка «перед предмета» — куда он будет смотреть (на вас).
  const arrow = new THREE.Mesh(new THREE.CircleGeometry(0.03, 3).rotateX(-Math.PI / 2).rotateY(Math.PI / 2), ringMat);
  arrow.position.z = footR + 0.04;
  // Для стены всё кольцо поворачиваем в вертикальную плоскость (лицом от стены), стрелку не показываем.
  const reticleFace = new THREE.Group();
  reticleFace.add(fill, ring, dot);
  if (wall) reticleFace.rotation.x = Math.PI / 2; else reticleFace.add(arrow);
  reticle.add(reticleFace);
  reticle.visible = false;
  scene.add(reticle);

  // ---------- Hit-test только по плоскостям (стабильнее точек) ----------
  const viewerSpace = await session.requestReferenceSpace('viewer');
  let hitSource, hitMode = 'plane';
  try { hitSource = await session.requestHitTestSource({ space: viewerSpace, entityTypes: ['plane'] }); }
  catch { hitSource = await session.requestHitTestSource({ space: viewerSpace }); hitMode = 'любые'; }
  log(`hit-test: ${hitMode}`);

  // ---------- Состояние ----------
  let placed = false, lastHit = null, lastHitAt = 0, everHit = false, anchor = null;
  const reticlePos = new THREE.Vector3(), targetPos = new THREE.Vector3();
  const camPos = new THREE.Vector3(), q = new THREE.Quaternion(), up = new THREE.Vector3();
  let stats = { hits: 0, upY: 0, fps: 0 }, frames = 0, fpsAt = performance.now();

  const TEXT = {
    floor: ['Поводите телефоном над полом', 'Стоит на полу'],
    table: ['Поводите телефоном над столом', 'Стоит на столе'],
    wall: ['Поводите телефоном перед стеной', 'Висит на стене'],
  }[placement] ?? ['Поводите телефоном над полом', 'Стоит на полу'];
  overlay.querySelector('.xr-search-text').textContent = TEXT[0];
  overlay.querySelector('.xr-placed-text').textContent = TEXT[1];
  let wallYaw = 0;
  overlay.querySelector('.xr-rotate-hint').hidden = wall;
  setState(overlay, 'searching');

  function yawToCamera(p) { return Math.atan2(camPos.x - p.x, camPos.z - p.z); }

  async function place() {
    if (placed || !reticle.visible) return;
    placed = true;
    root.position.copy(reticlePos);
    root.rotation.set(0, wall ? wallYaw : yawToCamera(reticlePos), 0);
    root.visible = true;
    reticle.visible = false;
    setState(overlay, 'placed');
    log(`поставлен: y=${reticlePos.y.toFixed(3)}`);
    // Якорь: система сама уточняет положение точки в мире — предмет не дрейфует.
    if (lastHit?.createAnchor) {
      try { anchor = await lastHit.createAnchor(); log('якорь создан'); }
      catch (e) { log(`якорь недоступен: ${e.message}`); }
    } else log('якоря не поддерживаются — фиксируем по координатам');
  }

  function reset() {
    placed = false;
    anchor?.delete?.();
    anchor = null;
    root.visible = false;
    setState(overlay, everHit ? 'lost' : 'searching');
    log('переставить');
  }

  // Касание экрана (select) ставит предмет. Кнопки оверлея касание не «съедают» в сцену.
  session.addEventListener('select', () => place());
  // Слой поворота перехватывает касания только после постановки — до неё касание ставит предмет.
  const block = (e) => { if (e.currentTarget.classList.contains('xr-drag') && !placed) return; e.preventDefault(); };
  const btns = overlay.querySelectorAll('button, .xr-drag');
  btns.forEach((b) => b.addEventListener('beforexrselect', block));

  // Поворот одним пальцем после постановки.
  const drag = overlay.querySelector('.xr-drag');
  let dragX = null;
  const onDown = (e) => { if (placed) dragX = e.clientX; };
  const onMove = (e) => { if (placed && !wall && dragX != null) { root.rotation.y += (e.clientX - dragX) * 0.012; dragX = e.clientX; } };
  const onUp = () => { dragX = null; };
  drag.addEventListener('pointerdown', onDown);
  drag.addEventListener('pointermove', onMove);
  drag.addEventListener('pointerup', onUp);
  drag.addEventListener('pointercancel', onUp);

  const closeBtn = overlay.querySelector('#xr-close');
  const resetBtn = overlay.querySelector('#xr-reset');
  const onClose = () => session.end();
  closeBtn.addEventListener('click', onClose);
  resetBtn.addEventListener('click', reset);

  // ---------- Кадр ----------
  renderer.setAnimationLoop((t, frame) => {
    if (!frame) return;
    const vp = frame.getViewerPose(refSpace);
    if (vp) camPos.set(vp.transform.position.x, vp.transform.position.y, vp.transform.position.z);

    if (!placed) {
      const hits = frame.getHitTestResults(hitSource);
      stats.hits = hits.length;
      let found = null;
      for (const h of hits) {
        const pose = h.getPose(refSpace);
        if (!pose) continue;
        const o = pose.transform.orientation;
        q.set(o.x, o.y, o.z, o.w);
        up.set(0, 1, 0).applyQuaternion(q);
        stats.upY = up.y;
        if (!wall && up.y >= UP_MIN) { found = { h, p: pose.transform.position }; break; }
        // Стена: нормаль горизонтальна; предмет смотрит вдоль нормали (от стены к вам).
        if (wall && Math.abs(up.y) <= WALL_MAX) { found = { h, p: pose.transform.position, yaw: Math.atan2(up.x, up.z) }; break; }
      }
      if (found) {
        targetPos.set(found.p.x, found.p.y, found.p.z);
        if (!reticle.visible) reticlePos.copy(targetPos); else reticlePos.lerp(targetPos, SMOOTH);
        reticle.position.copy(reticlePos);
        if (wall) wallYaw = found.yaw;
        reticle.rotation.set(0, wall ? wallYaw : yawToCamera(reticlePos), 0); // всегда ровно, стрелка к вам
        const pulse = 1 + 0.04 * Math.sin(t / 220);
        ring.scale.setScalar(pulse);
        reticle.visible = true;
        lastHit = found.h; lastHitAt = t; everHit = true;
        setState(overlay, 'ready');
      } else if (t - lastHitAt > LOST_AFTER_MS || !everHit) {
        reticle.visible = false;
        setState(overlay, everHit ? 'lost' : 'searching');
      }
    } else if (anchor) {
      const ap = frame.getPose(anchor.anchorSpace, refSpace);
      if (ap) root.position.set(ap.transform.position.x, ap.transform.position.y, ap.transform.position.z);
    }

    // Свет сверху-сбоку от предмета — тень ложится рядом, а не под ним целиком.
    const base = root.visible ? root.position : reticlePos;
    if (wall) sun.position.set(base.x + Math.sin(wallYaw) * 2 + 0.3, base.y + 1.5, base.z + Math.cos(wallYaw) * 2);
    else sun.position.set(base.x + 0.6, base.y + size.y + 2.5, base.z + 0.9);
    sun.target.position.copy(base);

    renderer.render(scene, camera);

    frames++;
    if (debugEl && t - fpsAt > 500) {
      stats.fps = Math.round((frames * 1000) / (t - fpsAt)); frames = 0; fpsAt = t;
      debugEl.textContent = [
        `состояние: ${overlay.dataset.state}`, `hit-test: ${hitMode}, попаданий ${stats.hits}, up.y ${stats.upY.toFixed(2)}`,
        `якорь: ${anchor ? 'да' : 'нет'}  fps: ${stats.fps}`,
        `позиция: ${root.visible ? `${root.position.x.toFixed(2)}, ${root.position.y.toFixed(2)}, ${root.position.z.toFixed(2)}` : '—'}`,
      ].join('\n');
    }
  });

  // ---------- Завершение ----------
  session.addEventListener('end', () => {
    renderer.setAnimationLoop(null);
    hitSource?.cancel?.();
    anchor?.delete?.();
    closeBtn.removeEventListener('click', onClose);
    resetBtn.removeEventListener('click', reset);
    btns.forEach((b) => b.removeEventListener('beforexrselect', block));
    drag.removeEventListener('pointerdown', onDown);
    drag.removeEventListener('pointermove', onMove);
    drag.removeEventListener('pointerup', onUp);
    drag.removeEventListener('pointercancel', onUp);
    scene.traverse((o) => { o.geometry?.dispose?.(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.dispose?.()); });
    envTex.dispose(); pmrem.dispose();
    overlay.hidden = true;
    busy = false;
    log('сессия закрыта');
    onEnd();
  }, { once: true });
}
