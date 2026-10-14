import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { existsSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const state = path.resolve(process.env.PROVER_STATE_DIR || path.join(project, '.local'));
const artifact = path.resolve(process.env.VERIROUTER_ARTIFACT_DIR || path.join(project, '../VeriRouter-release'));
const key = path.join(state, 'demo-provider.pem');
const jobs = new Map();
let active;
let lastStarted = 0;
function terminate(child) {
  if (!child?.pid) return;
  try { if (process.platform === 'win32') child.kill('SIGTERM'); else process.kill(-child.pid, 'SIGTERM'); }
  catch { /* The process has already exited. */ }
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function issuer() {
  await mkdir(state, { recursive: true, mode: 0o700 });
  if (!existsSync(key)) {
    execFileSync('openssl', ['genpkey', '-algorithm', 'Ed25519', '-out', key], { stdio: 'pipe' });
    chmodSync(key, 0o600);
  }
  return execFileSync('openssl', ['pkey', '-in', key, '-pubout'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function snapshot(job) {
  return { id: job.id, state: job.state, stage: job.stage, elapsed_ms: (job.finished || Date.now()) - job.started,
    ...(job.state === 'ready' ? { bundle_url: `api/jobs/${job.id}/bundle.json` } : {}),
    ...(job.state === 'error' ? { message: job.message } : {}) };
}

export async function handleApi(request, response, pathname) {
  if (!pathname.startsWith('/api/')) return false;
  if (pathname === '/api/config' && request.method === 'GET') {
    const available = existsSync(path.join(artifact, 'scripts/demo.py'));
    json(response, 200, { available, provider_public_key_pem: available ? await issuer() : null });
    return true;
  }
  if (pathname === '/api/prove' && request.method === 'POST') {
    request.resume();
    if (Number(request.headers['content-length'] || 0) > 1024) {
      json(response, 413, { message: 'This endpoint runs the built-in small example.' }); return true;
    }
    // The public endpoint runs one fixed small example, without user-supplied code or paths.
    const origin = request.headers.origin;
    if (origin && new URL(origin).host !== request.headers.host) {
      json(response, 403, { message: 'Use the demo from this website.' }); return true;
    }
    if (active || Date.now() - lastStarted < 2000) {
      response.setHeader('Retry-After', '5');
      json(response, 429, { message: 'The prover is working on another request. Try again shortly.' }); return true;
    }
    if (!existsSync(path.join(artifact, 'scripts/demo.py'))) {
      json(response, 503, { message: 'The proof-generation service is not connected.' }); return true;
    }
    await issuer();
    const id = randomUUID();
    const out = path.join(state, 'jobs', id);
    await mkdir(out, { recursive: true, mode: 0o700 });
    const job = { id, out, state: 'running', stage: 'selection', started: Date.now() };
    active = job; lastStarted = job.started; jobs.set(id, job);
    const child = spawn(process.env.PYTHON || 'python3', [path.join(project, 'server/prove.py'),
      '--artifact', artifact, '--out', out, '--rid', id, '--key', key],
      { env: { ...process.env, PYTHONUNBUFFERED: '1',
          CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || path.join(state, 'target') },
        detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    job.child = child;
    let tail = '';
    const onOutput = (chunk) => {
      const text = chunk.toString();
      tail = (tail + text).slice(-8000);
      if (text.includes('compile Rust')) job.stage = 'building';
      if (text.includes('Model-selection Proof')) job.stage = 'selection';
      if (text.includes('Serving Certificate')) job.stage = 'certificate';
      if (text.includes('Request-rewrite Proof')) job.stage = 'rewrite';
      if (text.includes('WEB_PROOFS_READY')) job.stage = 'complete';
    };
    child.stdout.on('data', onOutput); child.stderr.on('data', onOutput);
    const timeout = setTimeout(() => { job.message = 'Proof generation timed out. Please try again.'; terminate(child); }, 600_000);
    const finish = async (code) => {
      clearTimeout(timeout);
      job.finished = Date.now();
      job.state = code === 0 && existsSync(path.join(out, 'public/bundle.json')) ? 'ready' : 'error';
      if (job.state === 'error') {
        job.message ||= 'The prover could not finish this run. Please try again.';
        console.error(`Proof job ${id} failed:\n${tail}`);
      }
      active = undefined;
      // Keep public evidence only. Never expose or retain per-run witness copies.
      const { readdir } = await import('node:fs/promises');
      for (const name of await readdir(out)) if (name !== 'public') await rm(path.join(out, name), { recursive: true, force: true });
      const cleanup = setTimeout(async () => { jobs.delete(id); await rm(out, { recursive: true, force: true }); }, 1_200_000);
      cleanup.unref();
    };
    child.once('error', (error) => { tail += error.message; });
    child.once('close', (code) => { void finish(code); });
    json(response, 202, snapshot(job)); return true;
  }
  const match = pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})(?:\/(bundle\.json|(?:selection|rewrite)\.(?:proof|verifier)))?$/);
  if (match && request.method === 'GET') {
    const job = jobs.get(match[1]);
    if (!job) { json(response, 404, { message: 'This proof run has expired.' }); return true; }
    if (!match[2]) { json(response, 200, snapshot(job)); return true; }
    if (job.state !== 'ready') { json(response, 409, { message: 'Proof generation is still in progress.' }); return true; }
    const bytes = await readFile(path.join(job.out, 'public', match[2]));
    response.writeHead(200, { 'Content-Type': match[2].endsWith('.json') ? 'application/json' : 'application/octet-stream',
      'Cache-Control': 'no-store', 'Content-Length': bytes.length });
    response.end(bytes); return true;
  }
  json(response, 404, { message: 'Not found' }); return true;
}

export function stopProver() { terminate(active?.child); }
