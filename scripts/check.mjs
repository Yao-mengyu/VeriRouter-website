import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(path.join(root, 'index.html'), 'utf8');
const css = await readFile(path.join(root, 'styles.css'), 'utf8');
const js = await readFile(path.join(root, 'app.js'), 'utf8');
assert(/<script\b[^>]*type="module"[^>]*src="app\.js"/.test(html), 'The app must load as an ES module');
assert(/<script\b[^>]*src="video-player\.js"[^>]*defer/.test(html), 'Playback must load independently of the verifier module');
for (const file of ['app.js', 'video-player.js', 'evidence.js', 'verifier-worker.js', 'scripts/serve.mjs', 'scripts/open-preview.mjs', 'scripts/setup-prover.mjs', 'scripts/generate-proofs.mjs']) execFileSync(process.execPath, ['--check', path.join(root, file)]);
const files = [...html.matchAll(/(?:src|href|poster)="([^"#]+)"/g)].map((match) => match[1]);
for (const file of files.filter((file) => !/^(https?:|mailto:|data:)/.test(file))) {
  assert((await stat(path.resolve(root, file.split('#')[0]))).isFile(), `Missing asset: ${file}`);
}
for (const [, file] of css.matchAll(/url\(['"]?([^'"\)]+)['"]?\)/g)) {
  assert((await stat(path.resolve(root, file))).isFile(), `Missing CSS asset: ${file}`);
}
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(ids.length, new Set(ids).size, 'Duplicate HTML IDs');
for (const [, anchor] of html.matchAll(/href="#([^"\s]+)"/g)) assert(ids.includes(anchor), `Broken anchor: ${anchor}`);
for (const [, selector] of js.matchAll(/\$\(['"]#([\w-]+)['"]\)/g)) assert(ids.includes(selector), `Missing JS element: ${selector}`);
const trace = JSON.parse(await readFile(path.join(root, 'data/demo-trace.json'), 'utf8'));
assert.deepEqual(Object.keys(trace.cases), ['request', 'response', 'model', 'identity']);
assert.equal(trace.mode, 'live');
for (const entry of Object.values(trace.cases)) assert(entry.honest_response.content && entry.delivered_response.content && entry.attack_backend_response.model);
for (const film of ['attacks-all', 'verifications-all']) {
  assert((await stat(path.join(root, `assets/media/${film}.mp4`))).size > 1000000, `Missing original film: ${film}`);

}
for (const file of ['assets/attack-cover.png', 'assets/verification-cover.png', 'assets/social-card.png', 'assets/fonts/Inter-Tight-OFL.txt', 'assets/fonts/IBM-Plex-Mono-OFL.txt']) await stat(path.join(root, file));
const bundle = JSON.parse(await readFile(path.join(root, 'assets/zk/bundle.json'), 'utf8'));
for (const name of ['selection', 'rewrite']) {
  for (const key of ['proof', 'verifier']) await stat(path.join(root, 'assets/zk', bundle.proofs[name][key]));
}
assert(!html.includes('What does this guarantee depend on?'));
console.log('Checks passed: JavaScript, local assets, anchors, replay payload, films and public proof files.');
