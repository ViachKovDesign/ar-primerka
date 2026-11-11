// Точка входа для сборки библиотек админки в один локальный файл vendor/admin-libs.js (esbuild).
// Всё работает в браузере, без сервера и без CDN.
export { WebIO, Document, getBounds, ImageUtils, PropertyType } from '@gltf-transform/core';
export {
  ALL_EXTENSIONS, KHRMaterialsVariants, EXTMeshoptCompression, KHRDracoMeshCompression,
  KHRTextureBasisu, EXTTextureWebP, KHRMeshQuantization,
} from '@gltf-transform/extensions';
export { center, dedup, prune, weld, simplify, cloneDocument, dequantize, flatten } from '@gltf-transform/functions';
export { MeshoptSimplifier, MeshoptDecoder } from 'meshoptimizer';
export { zipSync, strToU8 } from 'fflate';
export { validateBytes } from 'gltf-validator';
