import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, cp, rm, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifact = path.resolve(process.env.VERIROUTER_ARTIFACT_DIR || path.join(project, '../VeriRouter-release'));
const local = path.join(project, '.local');
await mkdir(local, { recursive: true, mode: 0o700 });
const key = path.join(local, 'offline-provider.pem');
if (!existsSync(key)) {
  execFileSync('openssl', ['genpkey', '-algorithm', 'Ed25519', '-out', key], { stdio: 'pipe' });
  await chmod(key, 0o600);
}
const id = `offline-${randomUUID()}`;
const out = path.join(local, id);
await mkdir(out, { recursive: true, mode: 0o700 });
try {
  await new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON || 'python3', [path.join(project, 'scripts/prove.py'),
      '--artifact', artifact, '--out', out, '--rid', id, '--key', key],
      { env: { ...process.env, PYTHONUNBUFFERED: '1', CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || path.join(local, 'target') }, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Offline proving exited with code ${code}`)));
  });
  for (const name of ['bundle.json', 'selection.proof', 'selection.verifier', 'rewrite.proof', 'rewrite.verifier']) {
    await cp(path.join(out, 'public', name), path.join(project, 'assets/zk', name));
  }
  console.log('Saved fresh public proofs in assets/zk/. Build and publish the static website.');
} finally { await rm(out, { recursive: true, force: true }); }
