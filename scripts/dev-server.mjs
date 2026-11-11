// Локальный сервер для просмотра на компьютере (http://localhost:8080).
// AR на телефоне требует https — для этого GitHub Pages (см. README).
// Дополнительно: POST /__poster?name=<file> сохраняет постер (PNG dataURL → WebP) в posters/;
// используется страницей tools/posters.html, на сайт не влияет.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import sharp from 'sharp';

const ROOT = resolve('.');
const PORT = Number(process.env.PORT) || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.usdz': 'model/vnd.usdz+zip',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/__poster') {
      const name = (url.searchParams.get('name') || '').replace(/[^a-z0-9-]/gi, '');
      if (!name) { res.writeHead(400).end(); return; }
      let body = '';
      for await (const chunk of req) body += chunk;
      const png = Buffer.from(body.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      await mkdir('posters', { recursive: true });
      await sharp(png).resize(800, 800, { fit: 'inside' }).webp({ quality: 82 }).toFile(join('posters', `${name}.webp`));
      res.writeHead(200).end('ok');
      return;
    }
    // Только для локальной проверки админки: сохранить присланный файл в test-assets/out/.
    if (req.method === 'POST' && url.pathname === '/__save') {
      const name = (url.searchParams.get('name') || '').replace(/[^a-z0-9._-]/gi, '');
      if (!name) { res.writeHead(400).end(); return; }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      await mkdir('test-assets/out', { recursive: true });
      await writeFile(join('test-assets/out', name), Buffer.concat(chunks));
      res.writeHead(200).end('ok');
      return;
    }
    let path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if ((await stat(path).catch(() => null))?.isDirectory()) path = join(path, 'index.html');
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': TYPES[extname(path).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Не найдено');
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
