import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const noOpen = process.argv.includes('--no-open');
const server = spawn(process.execPath, [path.join(root, 'scripts/serve.mjs')], {
  cwd: root,
  env: { ...process.env, HOST: '127.0.0.1', PORT: '0' },
  stdio: ['inherit', 'pipe', 'inherit'],
});
let output = '';
let ready = false;
let exited = false;
let stoppingSignal;
let shutdownTimer;

server.stdout.setEncoding('utf8');
server.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  if (ready) return;
  output = (output + chunk).slice(-4096);
  const match = output.match(/VeriRouter:\s+(http:\/\/localhost:\d+)/);
  if (!match) return;
  ready = true;
  if (!noOpen) {
    const opener = spawn('open', [match[1]], { stdio: 'ignore' });
    opener.once('error', () => console.error(`Open ${match[1]} in your browser.`));
    opener.unref();
  }
});
server.once('error', (error) => {
  exited = true;
  console.error(`Preview could not start: ${error.message}`);
  process.exitCode = 1;
});
server.once('exit', (code, signal) => {
  exited = true;
  clearTimeout(shutdownTimer);
  const signalCode = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
  process.exitCode = stoppingSignal ? signalCode[stoppingSignal] : (code ?? signalCode[signal] ?? 1);
});

function stop(signal) {
  if (exited || stoppingSignal) return;
  stoppingSignal = signal;
  server.kill('SIGTERM');
  shutdownTimer = setTimeout(() => server.kill('SIGKILL'), 2000);
  shutdownTimer.unref();
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => stop(signal));
process.once('exit', () => {
  if (!exited && server.pid) server.kill('SIGTERM');
});
