'use strict';
import { exampleFor } from './evidence.js';

const $ = (selector) => document.querySelector(selector);
const parts = ['selection', 'rewrite', 'certificate'];
const variants = new Set(['honest', 'request', 'response', 'selection', 'model']);
let bundle;
let worker;
let busy = false;
let showResult = false;
let runId = 0;
let warmupPromise;
let rejectWarmup;
let rejectRun;

function renderApi() {
  if (!bundle) return;
  const variant = $('#proof-variant').value;
  const { question, model, response, clientApiRequest, forwardedApiRequest } = exampleFor(bundle, variant);
  $('#client-question').textContent = question;
  const isForwarded = variant === 'request';
  const isResponse = !isForwarded && (showResult || variant === 'response' || variant === 'selection' || variant === 'model');
  const payload = isForwarded ? forwardedApiRequest : isResponse ? { model, response } : clientApiRequest;
  $('#api-panel-title').textContent = isForwarded ? 'Forwarded request' : isResponse ? 'Returned response' : 'Client request';
  const json = JSON.stringify(payload, null, 2);
  const panel = $('#response-json');
  panel.replaceChildren();
  for (const line of json.split('\n')) {
    const row = document.createElement('span');
    row.className = 'json-line';
    if (((variant === 'selection' || variant === 'model') && line.includes(model))
      || (variant === 'response' && line.includes('CureAll-X'))
      || (variant === 'request' && line.includes('Patient context:'))) row.classList.add('changed-line');
    row.textContent = line;
    panel.append(row);
  }
  panel.scrollTop = 0;
  if (variant === 'request') {
    const changed = panel.querySelector('.changed-line');
    if (changed) panel.scrollTop = Math.max(0, changed.getBoundingClientRect().top - panel.getBoundingClientRect().top - panel.clientHeight / 3);
  }
}
function resetResults() {
  for (const part of parts) {
    const row = $(`#proof-${part}`);
    row.dataset.status = 'ready';
    row.querySelector('strong').textContent = 'Ready';
    row.querySelector('.proof-time').textContent = '—';
  }
  $('#proof-total').replaceChildren(document.createTextNode('— '), Object.assign(document.createElement('small'), {textContent:'ms'}));
  delete $('#proof-outcome').dataset.accept;
  delete $('#proof-outcome').dataset.variant;
}
function lockControls(value) {
  busy = value;
  $('#run-proof').disabled = value;
  $('#proof-variant').disabled = value;
  $('#proof-demo').classList.toggle('is-checking', value);
}
function verifier() {
  if (!worker) {
    worker = new Worker('verifier-worker.js', { type: 'module' });
    worker.addEventListener('error', () => {
      const error = new Error('The verifier could not load. Reload the page to try again.');
      rejectWarmup?.(error); rejectRun?.(error);
      worker.terminate(); worker = undefined; warmupPromise = undefined;
    });
  }
  return worker;
}
function warmup() {
  warmupPromise ||= new Promise((resolve, reject) => {
    const current = verifier();
    rejectWarmup = reject;
    const listener = ({ data }) => {
      if (data.type !== 'ready' && data.type !== 'error') return;
      current.removeEventListener('message', listener);
      rejectWarmup = undefined;
      if (data.type === 'error') { warmupPromise = null; reject(new Error(data.message)); }
      else resolve();
    };
    current.addEventListener('message', listener);
    current.postMessage({ type: 'warmup' });
  });
  return warmupPromise;
}
async function verifyEvidence() {
  if (busy) return;
  const variant = $('#proof-variant').value;
  if (!variants.has(variant)) return;
  lockControls(true);
  resetResults();
  renderApi();
  $('#proof-outcome').textContent = 'Loading the verifier…';
  const id = ++runId;
  try {
    await warmup();
    $('#proof-outcome').textContent = 'Verifying…';
    await new Promise((resolve, reject) => {
      const current = verifier();
      rejectRun = reject;
      const listener = ({ data }) => {
        if (data.runId !== id) return;
        if (data.type === 'progress') {
          $(`#proof-${data.part} strong`).textContent = 'Checking…';
          return;
        }
        current.removeEventListener('message', listener);
        rejectRun = undefined;
        if (data.type === 'error') { reject(new Error(data.message)); return; }
        for (const part of parts) {
          const check = part === 'certificate' ? data.certificate : data.proofs[part];
          const row = $(`#proof-${part}`);
          row.dataset.status = check.valid ? 'valid' : 'invalid';
          row.querySelector('strong').textContent = check.valid ? 'PASS' : 'REJECT';
          row.querySelector('.proof-time').textContent = `${check.milliseconds.toFixed(1)} ms`;
        }
        $('#proof-total').replaceChildren(document.createTextNode(`${data.total_milliseconds.toFixed(1)} `), Object.assign(document.createElement('small'), {textContent:'ms'}));
        const failed = variant === 'selection' ? 'Wrong model selection.'
          : variant === 'model' && !data.proofs.selection.valid ? 'Wrong model selection and false model identity.'
          : variant === 'model' ? 'False model identity.'
          : variant === 'request' ? 'Unapproved request rewriting.' : 'The answer was altered.';
        $('#proof-outcome').textContent = data.accept ? 'Verified.' : `Rejected. ${failed}`;
        $('#proof-outcome').dataset.accept = String(data.accept);
        $('#proof-outcome').dataset.variant = variant;
        showResult = true;
        renderApi();
        resolve();
      };
      current.addEventListener('message', listener);
      current.postMessage({ variant, runId: id });
    });
  } catch (error) {
    $('#proof-outcome').textContent = error.message;
  } finally { lockControls(false); }
}
$('#run-proof').addEventListener('click', verifyEvidence);
$('#proof-variant').addEventListener('change', () => {
  showResult = false;
  renderApi();
  resetResults();
  $('#proof-outcome').textContent = 'Ready to verify.';
});
fetch('assets/zk/bundle.json').then((response) => {
  if (!response.ok) throw new Error('The saved response could not be loaded.');
  return response.json();
}).then((data) => { bundle = data; renderApi(); }).catch((error) => { $('#response-json').textContent = error.message; });
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) { void warmup().catch(() => {}); observer.disconnect(); }
  }, { rootMargin: '400px' });
  observer.observe($('#proof-demo'));
}
$('#copy-citation').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#bibtex').textContent);
    $('#copy-result').textContent = 'BibTeX copied.';
    $('#copy-citation').lastChild.textContent = ' Copied';
    setTimeout(() => { $('#copy-citation').lastChild.textContent = ' Copy'; }, 1800);
  } catch {
    const range = document.createRange(); range.selectNodeContents($('#bibtex'));
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    $('#copy-result').textContent = 'Citation selected for copying.';
  }
});
