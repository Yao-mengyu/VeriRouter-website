import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import './check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'dist');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js', 'evidence.js', 'verifier-worker.js', 'assets', 'data', '.nojekyll', '_headers', 'robots.txt']) {
  await cp(path.join(root, file), path.join(destination, file), { recursive: true });
}
if (process.env.SITE_URL) {
  const siteUrl = new URL(process.env.SITE_URL);
  if (siteUrl.protocol !== 'https:' && siteUrl.protocol !== 'http:') throw new Error('SITE_URL must be an HTTP(S) URL');
  if (!siteUrl.pathname.endsWith('/')) siteUrl.pathname += '/';
  const htmlPath = path.join(destination, 'index.html');
  let html = await readFile(htmlPath, 'utf8');
  html = html.replace('content="assets/social-card.png"', `content="${new URL('assets/social-card.png', siteUrl).href}"`);
  html = html.replace('</head>', `  <link rel="canonical" href="${siteUrl.href}">\n  <meta property="og:url" content="${siteUrl.href}">\n</head>`);
  await writeFile(htmlPath, html);
}
console.log('Production site built in dist/ (static, no runtime dependencies).');
