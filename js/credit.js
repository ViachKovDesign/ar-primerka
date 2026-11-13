// Подпись «Автор и лицензия модели» (поле credit в catalog.json).
// Распознаём лицензию Creative Commons в тексте, даём ссылку на неё и проверяем,
// что для CC BY указан автор (лицензия этого требует). Модуль без импортов: админка и тесты в Node.

const CC_BASE = 'https://creativecommons.org/';

/**
 * Лицензия Creative Commons в тексте: «CC BY 4.0», «CC-BY-SA-4.0», «CC BY-NC 3.0», «CC0».
 * @returns {{ code: string, url: string | null, attribution: boolean } | null}
 *   attribution — лицензия требует указать автора (все CC BY*, но не CC0).
 *   url — только если версия указана: «CC BY» без версии не связываем с 4.0 наугад.
 */
export function detectLicense(text) {
  const s = String(text ?? '');
  if (/\bCC\s*0\b|\bCC-?Zero\b|public\s*domain\s*dedication/i.test(s)) {
    return { code: 'CC0 1.0', url: `${CC_BASE}publicdomain/zero/1.0/`, attribution: false };
  }
  const m = s.match(/\bCC[\s-]*BY((?:[\s-]*(?:NC|SA|ND))*)(?:[\s-]*(\d\.\d))?/i);
  if (!m) return null;
  const parts = (m[1].match(/NC|SA|ND/gi) ?? []).map((p) => p.toLowerCase());
  const version = m[2] ?? null;
  const kind = ['by', ...parts].join('-');
  return {
    code: `CC ${kind.toUpperCase()}${version ? ` ${version}` : ''}`,
    url: version ? `${CC_BASE}licenses/${kind}/${version}/` : null,
    attribution: true,
  };
}

// Слова, которые не являются автором: лицензия, служебные слова, ссылки, знаки.
const NOT_AUTHOR = [
  /https?:\/\/\S+/gi,
  /\bCC[\s-]*BY(?:[\s-]*(?:NC|SA|ND))*(?:[\s-]*\d\.\d)?/gi,
  /\b(?:creative\s*commons|attribution|license|licen[cs]e?d?|international|copyright|all\s*rights\s*reserved)\b/gi,
  /(?:^|[\s,.;:()«»"'])(?:3d-?\s*)?(?:модель|лицензия|лицензии|автор|изменена|изменено|изм\.)(?=$|[\s,.;:()«»"'])/gi,
  /\(c\)|©/gi,
  /\b\d{4}\b/g,
];

/** Остался ли в подписи кто-то, кроме лицензии и служебных слов (минимум 2 буквы подряд). */
export function hasAuthor(text) {
  let s = String(text ?? '');
  for (const re of NOT_AUTHOR) s = s.replace(re, ' ');
  return /\p{L}{2,}/u.test(s);
}

/**
 * Предупреждение для админки или null.
 * @param {string} credit       — что ввели в поле «Автор и лицензия модели»
 * @param {string} [fileNote]   — asset.copyright из загруженного GLB (если есть)
 */
export function creditWarning(credit, fileNote = '') {
  const text = String(credit ?? '').trim();
  const lic = detectLicense(text);
  const fileLic = detectLicense(fileNote);
  if (!text && fileLic?.attribution) {
    return `В файле модели указана лицензия ${fileLic.code} («${String(fileNote).trim()}»). Она требует указать автора — заполните поле «Автор и лицензия модели».`;
  }
  if (lic?.attribution && !hasAuthor(text)) {
    return `Лицензия ${lic.code} требует указать автора модели — допишите, чья она (например: «Название модели» © Автор, ${lic.code}).`;
  }
  return null;
}

/** Поля для catalog.json: credit + ссылка на лицензию, если её удалось распознать. */
export function creditFields(credit) {
  const text = String(credit ?? '').trim();
  if (!text) return {};
  const lic = detectLicense(text);
  return { credit: text, ...(lic?.url ? { credit_license_url: lic.url } : {}) };
}
