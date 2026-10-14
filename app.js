'use strict';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const state = { attack: 'request', mode: 'opaque', film: 'attack', trace: null, replayTimers: [], transitionTimers: [], step: 3 };
const scenarios = {
  request: {
    title: 'A hidden instruction becomes a product recommendation.',
    description: 'The router adds a preference the client never supplied.',
    rejection: 'Unendorsed addition to the request'
  },
  response: {
    title: 'The model never wrote this advertisement.',
    description: 'The intermediary appends sponsored content after inference.',
    rejection: 'Response does not match the signed binding'
  },
  model: {
    title: 'A cheaper model serves a query it is not eligible for.',
    description: 'The returned answer is real; the substituted route violates the example policy.',
    rejection: 'Selected model is outside the eligible set'
  },
  identity: {
    title: 'A model label can be a false alibi.',
    description: 'Qwen produced the answer. The intermediary relabels it as GPT-6 Astra.',
    rejection: 'Claimed model does not match the signed binding'
  }
};

function icon(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${id}`);
  svg.append(use);
  return svg;
}

function stopReplay() {
  for (const timer of state.replayTimers || []) clearTimeout(timer);
  state.replayTimers = [];
  for (const timer of state.transitionTimers || []) clearTimeout(timer);
  state.transitionTimers = [];
  state.playing = false;
  $('.demo-shell').classList.remove('is-replaying');
  $('#replay-button').disabled = !state.trace;
  $('#replay-button').replaceChildren(icon('play'), document.createTextNode(state.mode === 'verified' ? 'Replay verification' : 'Play the attack'));
}

function paintJson(container, object, changedPhrases = []) {
  container.replaceChildren();
  let json;
  if (object.messages) {
    const rest = Object.entries(object).filter(([key]) => key !== 'model' && key !== 'messages');
    json = '{\n  "model": ' + JSON.stringify(object.model) + ',\n  "messages": [\n' + object.messages.map((message) => '    ' + JSON.stringify(message)).join(',\n') + '\n  ]' + rest.map(([key, value]) => ',\n  ' + JSON.stringify(key) + ': ' + JSON.stringify(value)).join('') + '\n}';
  } else json = JSON.stringify(object, null, 2);
  for (const line of json.split('\n')) {
    const row = document.createElement('span'); row.className = 'json-line';
    if (changedPhrases.some((phrase) => phrase && line.includes(phrase))) row.classList.add('changed-line');
    const tokens = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null|\d+)\b/g;
    let last = 0;
    for (const match of line.matchAll(tokens)) {
      row.append(document.createTextNode(line.slice(last, match.index)));
      const token = document.createElement('span');
      token.className = match[2] ? 'json-key' : match[3] ? 'json-number' : 'json-string';
      token.textContent = match[0]; row.append(token); last = match.index + match[0].length;
    }
    row.append(document.createTextNode(line.slice(last))); container.append(row);
  }
  container.parentElement.scrollTop = 0;
}

function renderPayloads(step) {
  const record = state.trace.cases[state.attack];
  const scenario = scenarios[state.attack];
  const payload = step === 0 ? record.client_request : step === 1 ? record.attack_forwarded_request : step === 2 ? record.attack_backend_response : record.delivered_response;
  const highlight = step === 1 && state.attack === 'request' ? ['Patient context:'] : step === 1 && (state.attack === 'model' || state.attack === 'identity') ? [record.attack_forwarded_request.model] : step === 3 && state.attack === 'identity' ? [record.delivered_response.model] : step >= 2 && state.attack === 'request' || step === 3 && state.attack === 'response' ? ['CureAll-X'] : [];
  paintJson($('#mutation-content'), payload, highlight);
  $('#mutation-label').textContent = ['client_request.json', 'router_forwarded.json', 'provider_response.json', 'client_received.json'][step];
  $('#result-label').textContent = step < 2 ? 'REQUEST' : 'RESPONSE';
  const evidence = $('#evidence-result');
  const text = document.createElement('span');
  if (step < 3) {
    evidence.className = 'evidence-result is-pending';
    text.textContent = ['Original client request', 'Request sent to the selected backend', 'Actual recorded provider response'][step];
    evidence.replaceChildren(icon(step < 2 ? 'message' : 'provider'), text);
  } else if (state.mode === 'verified') {
    evidence.className = 'evidence-result is-rejected';
    text.textContent = `REJECT · ${scenario.rejection}`;
    evidence.replaceChildren(icon('shield-x'), text);
  } else {
    evidence.className = 'evidence-result';
    text.textContent = 'UNVERIFIED · No serving evidence accompanies the delivered answer';
    evidence.replaceChildren(icon('eye-off'), text);
  }
}

function setStage(step, animate = true) {
  if (!state.trace) return;
  state.step = step;
  const record = state.trace.cases[state.attack];
  const verified = state.mode === 'verified';
  const scenario = scenarios[state.attack];
  const stages = [
    ['The client sends the original request.', 'User request', 'request', 'var(--client-position)'],
    [state.attack === 'request' ? 'The router adds an unapproved system instruction.' : state.attack === 'model' || state.attack === 'identity' ? 'The router substitutes the backend model.' : 'The router forwards the request to the model.', state.attack === 'request' ? 'Injected request' : state.attack === 'model' || state.attack === 'identity' ? 'Rerouted request' : 'Prepared request', state.attack === 'response' ? 'normal' : 'attack', '50%'],
    ['The backend returns its actual answer.', verified && state.attack !== 'model' ? 'Answer + certificate' : 'Model answer', 'response', 'var(--provider-position)'],
    [verified ? scenario.rejection : state.attack === 'response' ? 'The router adds an advertisement to the returning answer.' : state.attack === 'identity' ? 'The router falsifies the model label before delivery.' : 'The client receives the answer, without evidence of the route.', verified ? 'Verification failed' : 'Delivered reply', verified ? 'rejected' : 'attack', 'var(--client-position)']
  ];
  const [status, label, kind, position] = stages[step];
  $('#stage-counter').textContent = `STEP ${String(step + 1).padStart(2, '0')} / 04`;
  const packet = $('#transport-packet');
  const finish = () => {
    $('#stage-status').textContent = status;
    $('#packet-label').textContent = label;
    packet.dataset.kind = kind;
    renderPayloads(step);
  };
  if (animate && !reducedMotion.matches && step > 0) {
    state.transitionTimers ||= [];
    if (step === 3) {
      $('#stage-status').textContent = 'Provider → Router → Client. Returning the answer.';
      packet.style.transitionDuration = '1.3s';
      packet.style.left = '50%';
      state.transitionTimers.push(setTimeout(() => {
        $('#packet-label').textContent = verified ? (state.attack === 'model' ? 'Answer + proof claim' : 'Answer + evidence') : state.attack === 'response' || state.attack === 'identity' ? 'Modified reply' : 'Delivered reply';
        packet.dataset.kind = verified ? 'response' : 'attack';
        packet.style.left = position;
      }, 1300));
      state.transitionTimers.push(setTimeout(finish, 2600));
    } else {
      $('#stage-status').textContent = step === 1 ? 'Client → Router. Sending the original request.' : 'Router → Provider. Forwarding the prepared request.';
      packet.style.transitionDuration = '2s';
      packet.style.left = position;
      state.transitionTimers.push(setTimeout(finish, 2000));
    }
  } else {
    packet.style.transitionDuration = '0s';
    packet.style.left = position;
    finish();
  }
  $('#provider-model').textContent = step === 0 ? 'Awaiting selection' : record.attack_backend_response.model === 'google/gemini-2.5-flash' ? 'Gemini 2.5 Flash' : 'Qwen 2.5 7B';
  $$('[data-node]').forEach((node) => node.dataset.active = String(node.dataset.node === ['client', 'router', 'model', 'client'][step]));
  $$('[data-step]').forEach((item) => { if (Number(item.dataset.step) === step) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current'); });
}

function renderAttack(initialStep = 0) {
  if (!state.trace) return;
  stopReplay();
  const scenario = scenarios[state.attack];
  const verified = state.mode === 'verified';
  $('.demo-shell').dataset.verified = String(verified);
  $('#attack-select').value = state.attack;
  $('#verified-toggle').checked = verified;
  $('#client-request').textContent = `“${state.trace.user_task}”`;
  $('#router-label').textContent = verified ? 'VERIROUTER' : 'COMPROMISED ROUTER';
  $('#router-subtitle').textContent = verified ? 'Evidence required' : 'The hidden trust boundary';
  $('#scenario-title').textContent = scenario.title;
  const evidence = $('#stage-evidence');
  evidence.replaceChildren();
  if (verified) {
    const applicable = state.attack === 'model' ? ['selection'] : state.attack === 'request' ? ['rewrite', 'certificate'] : ['certificate'];
    [['selection', 'Selection proof'], ['rewrite', 'Rewrite proof'], ['certificate', 'Serving certificate']].forEach(([id, label]) => {
      const item = document.createElement('span'); item.className = `proof-item ${applicable.includes(id) ? 'applicable' : ''}`;
      item.append(icon(id), document.createTextNode(label));
      evidence.append(item);
    });
  } else {
    const item = document.createElement('span'); item.className = 'no-evidence';
    item.append(icon('eye-off'), document.createTextNode('No proof of what happened behind the router.'));
    evidence.append(item);
  }
  state.paused = false;
  setStage(initialStep, false);
}

async function initReplay() {
  try {
    const response = await fetch('data/demo-trace.json');
    if (!response.ok) throw new Error(`Trace request failed (${response.status})`);
    state.trace = await response.json();
    renderAttack();

  } catch (error) {
    $('#client-request').textContent = 'The recorded trace could not be loaded. Please refresh, or watch the films below.';
    $('#scenario-title').textContent = 'The browser replay is temporarily unavailable.';
    console.error(error);
  }
}

$('#attack-select').addEventListener('change', (event) => { state.attack = event.target.value; renderAttack(); });
$('#verified-toggle').addEventListener('change', (event) => { state.mode = event.target.checked ? 'verified' : 'opaque'; renderAttack(state.step); });
$('#replay-button').addEventListener('click', () => {
  if (!state.trace) return;
  if (state.playing) {
    const current = state.step;
    stopReplay(); setStage(current, false); state.paused = current < 3;
    $('#replay-button').replaceChildren(icon('play'), document.createTextNode(state.paused ? 'Continue' : 'Replay'));
    return;
  }
  const startingStep = state.paused && state.step < 3 ? state.step : 0;
  stopReplay(); state.paused = false; state.playing = true;
  const shell = $('.demo-shell'); void shell.offsetWidth; shell.classList.add('is-replaying');
  $('#replay-button').replaceChildren(icon('pause'), document.createTextNode('Pause'));
  setStage(startingStep, false);
  const interval = reducedMotion.matches ? 150 : 5200;
  $('.demo-timeline span').style.animationDuration = `${interval * (4 - startingStep)}ms`;
  state.replayTimers = [];
  for (let step = startingStep + 1; step < 4; step++) state.replayTimers.push(setTimeout(() => setStage(step), interval * (step - startingStep)));
  state.replayTimers.push(setTimeout(() => { stopReplay(); state.paused = false; }, interval * (4 - startingStep)));
});

const films = {
  attack: {
    file: 'attacks-all', label: 'Four router attacks, full narrated walkthrough',
    description: 'Four local router attacks using recorded OpenRouter API responses.',
    chapters: [[0, 'The hidden trust gap'], [145, 'Prompt injection'], [187.1, 'Answer tampering'], [230.067, 'Wrong model selection'], [265.6, 'Identity spoofing']]
  },
  verify: {
    file: 'verifications-all', label: 'VeriRouter verification, full narrated protocol walkthrough',
    description: 'Illustrated ZK proofs and serving-certificate checks for the same four attacks.',
    chapters: [[0, 'The evidence workflow'], [60.9, 'Endorsed rewriting'], [132.2, 'Response integrity'], [196.633, 'Model eligibility'], [269.633, 'Model identity']]
  }
};
const player = $('#walkthrough-video');
function timestamp(seconds) { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
function renderChapters() {
  const list = $('#chapter-list');
  list.replaceChildren();
  films[state.film].chapters.forEach(([time, label]) => {
    const button = document.createElement('button');
    button.className = 'chapter-button';
    button.dataset.time = String(time);
    button.setAttribute('aria-label', `${label}, ${timestamp(time)}`);
    const stamp = document.createElement('span'); stamp.className = 'mono'; stamp.textContent = timestamp(time);
    button.append(stamp, document.createTextNode(label));
    button.addEventListener('click', () => {
      const seek = () => { player.currentTime = time; player.play().catch(() => {}); updateChapter(); };
      if (player.readyState >= 1) seek();
      else {

player.addEventListener('loadedmetadata', () => { player.currentTime = time; updateChapter(); }, { once: true });
        player.play().catch(() => {});
      }
    });
    list.append(button);
  });
  updateChapter();
}
function updateChapter() {
  const chapters = films[state.film].chapters;
  let current = 0;
  chapters.forEach(([time], index) => { if (player.currentTime >= time) current = index; });
  $$('.chapter-button').forEach((button, index) => button.setAttribute('aria-current', String(index === current)));
}
$$('[data-film]').forEach((button) => button.addEventListener('click', () => {
  if (state.film === button.dataset.film) return;
  player.pause();
  state.film = button.dataset.film;
  const film = films[state.film];
  player.querySelector('source').src = `assets/media/${film.file}.mp4`;
  player.poster = `assets/${state.film === 'attack' ? 'attacks' : 'verification'}-poster.jpg`;
  player.setAttribute('aria-label', film.label);
  player.load();
  $('#film-description').textContent = film.description;
  $('#film-download').href = `assets/media/${film.file}.mp4`;
  $$('[data-film]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
  renderChapters();
}));
$$('[data-view]').forEach((button) => button.addEventListener('click', () => {
  const interactive = button.dataset.view === 'interactive';
  stopReplay();
  setStage(state.step, false);
  $('#interactive-view').hidden = !interactive;
  $('#video-view').hidden = interactive;
  if (interactive) player.pause();
  else document.querySelector('[data-film="attack"]').click();
  $$('[data-view]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
  document.querySelector('[data-view="interactive"]').hidden = interactive;
  document.querySelector('[data-view="attack"]').hidden = !interactive;
  $('#demo-format-label').textContent = interactive ? 'Interactive replay' : 'Full walkthroughs';
}));

player.addEventListener('timeupdate', updateChapter);
renderChapters();

$('#copy-citation').addEventListener('click', async () => {
  const button = $('#copy-citation');
  try {
    await navigator.clipboard.writeText($('#bibtex').textContent);
    button.replaceChildren(icon('check'), document.createTextNode('Copied'));
    $('#copy-result').textContent = 'BibTeX citation copied.';
    setTimeout(() => button.replaceChildren(icon('copy'), document.createTextNode('Copy BibTeX')), 2200);
  } catch {
    const range = document.createRange(); range.selectNodeContents($('#bibtex'));
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    button.replaceChildren(icon('copy'), document.createTextNode('Select & copy'));
    $('#copy-result').textContent = 'Citation selected. Copy it using your browser’s copy command.';
  }
});

initReplay();

let proofWorker;
let proofContext = {};
let proofBusy = false;
let providerKey;
function resetProofResults() {
  for (const part of ['selection', 'rewrite', 'certificate']) {
    const row = $(`#proof-${part}`);
    row.dataset.status = 'ready';
    row.querySelector('strong').textContent = 'Ready';
  }
  delete $('#proof-outcome').dataset.accept;
}
function lockProofControls(busy) {
  proofBusy = busy;
  $('#run-proof').disabled = busy;
  $('#proof-variant').disabled = busy;
}
function verifyEvidence() {
  lockProofControls(true);
  resetProofResults();
  $('#proof-outcome').textContent = 'Checking the proofs and signature in your browser…';
  return new Promise((resolve, reject) => {
    if (!proofWorker) proofWorker = new Worker('verifier-worker.js', { type: 'module' });
    proofWorker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        $(`#proof-${data.part} strong`).textContent = 'Checking…';
        return;
      }
      if (data.type === 'error') { reject(new Error(data.message)); return; }
      for (const part of ['selection', 'rewrite', 'certificate']) {
        const check = part === 'certificate' ? data.certificate : data.proofs[part];
        const row = $(`#proof-${part}`);
        row.dataset.status = check.valid ? 'valid' : 'invalid';
        row.querySelector('strong').textContent = check.valid ? 'PASS' : 'REJECT';
      }
      $('#proof-outcome').textContent = data.accept
        ? 'VERIFIED · Both ZK proofs, the serving signature, and all shared bindings passed.'
        : 'REJECTED · The changed evidence failed verification.';
      $('#proof-outcome').dataset.accept = String(data.accept);
      $('#proof-outcome').dataset.variant = data.variant;
      $('#proof-public-model').textContent = data.claimed_model;
      $('#proof-public-response').textContent = data.fixture_response;
      $('#proof-run-id').textContent = proofContext.requestId ? `Run ${proofContext.requestId.slice(0, 8)}` : 'Saved example';
      $('#proof-answer').hidden = false;
      $('#tamper-controls').hidden = false;
      $('#proof-download').href = proofContext.bundleUrl || 'assets/zk/bundle.json';
      resolve(data);
    };
    proofWorker.onerror = () => {
      proofWorker.terminate(); proofWorker = null;
      reject(new Error('The browser verifier could not start. Reload the page to try again.'));
    };
    proofWorker.postMessage({ variant: $('#proof-variant').value, ...proofContext });
  });
}
$('#proof-variant').addEventListener('change', async () => {
  if (proofBusy) return;
  try { await verifyEvidence(); }
  catch (error) { $('#proof-outcome').textContent = error.message; }
  finally { lockProofControls(false); }
});
$('#run-proof').addEventListener('click', async () => {
  if (proofBusy) return;
  if (!providerKey) {
    try { await verifyEvidence(); }
    catch (error) { $('#proof-outcome').textContent = error.message; }
    finally { lockProofControls(false); $('#run-proof').disabled = false; }
    return;
  }
  lockProofControls(true);
  resetProofResults();
  $('#tamper-controls').hidden = true;
  $('#proof-answer').hidden = true;
  $('#proof-variant').value = 'honest';
  const started = performance.now();
  const clock = setInterval(() => { $('#proof-timer').textContent = `${((performance.now() - started) / 1000).toFixed(1)} s`; }, 100);
  const stages = { building: 'Preparing the Rust prover…', selection: 'Generating the selection ZK proof…',
    certificate: 'Signing the serving certificate…', rewrite: 'Generating the rewrite ZK proof…', complete: 'Loading the new public evidence…' };
  try {
    $('#proof-outcome').textContent = 'Starting a fresh proving run…';
    const response = await fetch('api/prove', { method: 'POST' });
    let job = await response.json();
    if (!response.ok) throw new Error(job.message || 'The prover could not start.');
    while (job.state === 'running') {
      $('#proof-outcome').textContent = stages[job.stage] || 'Generating proofs…';
      const completed = job.stage === 'rewrite' ? ['selection', 'certificate'] : job.stage === 'certificate' ? ['selection'] : [];
      for (const part of ['selection', 'rewrite', 'certificate']) {
        $(`#proof-${part} strong`).textContent = job.stage === part ? (part === 'certificate' ? 'Signing…' : 'Proving…') : completed.includes(part) ? 'Generated' : 'Waiting';
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const poll = await fetch(`api/jobs/${job.id}`);
      job = await poll.json();
      if (!poll.ok) throw new Error(job.message || 'Unable to retrieve this proof run.');
    }
    if (job.state !== 'ready') throw new Error(job.message || 'Proof generation failed.');
    proofContext = { bundleUrl: job.bundle_url, requestId: job.id, providerKey };
    await verifyEvidence();
  } catch (error) {
    $('#proof-outcome').textContent = error.message;
  } finally {
    clearInterval(clock);
    $('#proof-timer').textContent = `${((performance.now() - started) / 1000).toFixed(1)} s total`;
    lockProofControls(false);
  }
});
$('#run-proof').disabled = true;
fetch('api/config').then((response) => response.ok ? response.json() : null).then((config) => {
  if (config?.available) { providerKey = config.provider_public_key_pem; $('#run-proof').disabled = false; }
  else { $('#run-proof').disabled = false; $('#run-proof').replaceChildren(icon('shield'), document.createTextNode('Verify the example')); $('#proof-demo-description').textContent = 'Verify two Plonky2 ZK proofs and a signed serving certificate, then try changing the evidence.'; }
}).catch(() => { $('#run-proof').disabled = false; $('#run-proof').replaceChildren(icon('shield'), document.createTextNode('Verify the example')); $('#proof-demo-description').textContent = 'Verify two Plonky2 ZK proofs and a signed serving certificate, then try changing the evidence.'; });
