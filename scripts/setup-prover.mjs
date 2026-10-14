import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifact = path.resolve(process.env.VERIROUTER_ARTIFACT_DIR || path.join(root, '../VeriRouter-release'));
const child = spawn(process.env.PYTHON || 'python3', ['-c',
  'import sys; sys.path.insert(0, sys.argv[1]); from scripts import demo; demo.build_rust_binaries()', artifact],
  { env: { ...process.env, CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || path.join(root, '.local/target') }, stdio: 'inherit' });
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('close', (code) => { process.exitCode = code || 0; });
