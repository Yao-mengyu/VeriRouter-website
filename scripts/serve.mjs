import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(project, process.argv[2] || '.');
const port = Number(process.env.PORT || 4173);
const types = { '.wasm':'application/wasm', '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.ttf':'font/ttf', '.mp4':'video/mp4', '.vtt':'text/vtt; charset=utf-8', '.txt':'text/plain; charset=utf-8' };
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    if (!/^(?:\/(?:index\.html|styles\.css|app\.js|video-player\.js|evidence\.js|verifier-worker\.js|robots\.txt)?|\/(?:assets|data)\/[^.][^\0]*)$/.test(pathname)
      || pathname.split('/').some((part) => part.startsWith('.'))) { response.writeHead(404); response.end('Not found'); return; }
    const filename = path.resolve(root, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
    if (!filename.startsWith(`${root}${path.sep}`)) { response.writeHead(403); response.end('Forbidden'); return; }
    const info = await stat(filename);
    if (!info.isFile()) throw new Error('Not found');
    const headers = { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (range) {
      const start = Number(range[1]); const end = Math.min(info.size - 1, range[2] ? Number(range[2]) : info.size - 1);
      if (start > end || start >= info.size) { response.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); response.end(); return; }
      response.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Content-Length': end - start + 1 });
      if (request.method === 'HEAD') response.end(); else createReadStream(filename, { start, end }).pipe(response);
    } else {
      response.writeHead(200, { ...headers, 'Content-Length': info.size });
      if (request.method === 'HEAD') response.end(); else createReadStream(filename).pipe(response);
    }
  } catch { response.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8' }); response.end('Not found'); }
});
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`VeriRouter: http://localhost:${server.address().port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.close(); });
