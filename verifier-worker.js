import init, { hash_client_request, hash_query, verify_proof } from './assets/zk/verifier.js';
import { exampleFor } from './evidence.js';

const encoder = new TextEncoder();
const hex = (bytes) => Array.from(new Uint8Array(bytes), (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (value) => Uint8Array.from(value.match(/.{2}/g), (x) => parseInt(x, 16));
const fromBase64 = (value) => Uint8Array.from(atob(value), (x) => x.charCodeAt(0));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha = async (bytes) => hex(await crypto.subtle.digest('SHA-256', bytes));
const concatenate = (...parts) => {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
};
const field = (bytes) => {
  const prefix = new Uint8Array(4);
  new DataView(prefix.buffer).setUint32(0, bytes.length, false);
  return concatenate(prefix, bytes);
};
const hashoutBytes = (limbs) => {
  const result = new Uint8Array(32);
  const view = new DataView(result.buffer);
  limbs.forEach((limb, index) => view.setBigUint64(index * 8, BigInt(limb), false));
  return result;
};
async function loadBytes(file) {
  const response = await fetch(new URL(`./assets/zk/${file}`, import.meta.url));
  if (!response.ok) throw new Error(`Unable to load ${file} (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}
let fixturePromise;
async function fixture() {
  fixturePromise ||= (async () => {
    const [response, profileResponse] = await Promise.all([
      fetch(new URL('./assets/zk/bundle.json', import.meta.url)),
      fetch(new URL('./data/verifier-profile.json', import.meta.url))
    ]);
    if (!response.ok || !profileResponse.ok) throw new Error('Unable to load the saved evidence');
    const [bundle, profile] = await Promise.all([response.json(), profileResponse.json()]);
    if (bundle.question !== profile.question || !same(bundle.client_request, profile.client_request)
      || !same(bundle.model_catalog, profile.model_catalog)
      || bundle.bindings.selected_model !== profile.selected_model_id
      || bundle.selected_model_name !== profile.model_catalog[profile.selected_model_id]
      || !same(bundle.query_vector, profile.query_vector) || bundle.zero_point !== profile.zero_point) {
      throw new Error('The saved evidence does not match the verifier profile');
    }
    await init({ module_or_path: await loadBytes('verifier_bg.wasm') });
    const artifacts = {};
    for (const name of ['selection', 'rewrite']) {
      const record = bundle.proofs[name];
      const [proof, verifier] = await Promise.all([loadBytes(record.proof), loadBytes(record.verifier)]);
      if (await sha(verifier) !== record.verifier_sha256) throw new Error(`Pinned ${name} verifier key mismatch`);
      artifacts[name] = { proof, verifier };
    }
    return { bundle, profile, artifacts };
  })();
  return fixturePromise;
}

async function verifyEncoder(bundle, profile, example) {
  const statement = bundle.encoder_statement;
  // The small demo uses an exact public lookup; other requests have no entry.
  const knownRequest = same(example.clientRequest, profile.client_request);
  const clientHash = JSON.parse(hash_client_request(JSON.stringify(example.clientRequest)));
  const queryHash = JSON.parse(hash_query(JSON.stringify(profile.query_vector), profile.zero_point));
  const digest = await sha(concatenate(
    encoder.encode('VeriRoute.public_encoder_binding.v1'),
    field(encoder.encode(bundle.bindings.request_id)),
    field(encoder.encode(profile.encoder_id)),
    encoder.encode('hashout'), hashoutBytes(clientHash), hashoutBytes(queryHash)
  ));
  return knownRequest && statement.encoder_public === true && statement.encoder_id === profile.encoder_id
    && same(statement.client_request_hash, clientHash)
    && same(statement.route_query_hash, queryHash)
    && same(bundle.proofs.selection.public_inputs.slice(4, 8), queryHash)
    && same(bundle.bindings.route_client_request_hash, clientHash)
    && same(bundle.bindings.route_query_hash, queryHash)
    && statement.encoder_binding_digest === `sha256:${digest}`;
}

async function verifyServing(bundle, profile, example) {
  const certificate = example.certificate;
  const statement = certificate.statement;
  const bindings = bundle.bindings;
  const responseHash = await sha(encoder.encode(JSON.stringify(example.response)));
  const digest = await sha(concatenate(
    encoder.encode('VeriRouter.serving-certificate.v1'),
    field(encoder.encode(statement.rid)),
    field(encoder.encode(statement.model)),
    field(hashoutBytes(statement.request_commitment)),
    field(fromHex(statement.response_hash.slice(7)))
  ));
  const der = fromBase64(bundle.trusted_provider_public_key_pem.replace(/-----[^-]+-----|\s/g, ''));
  const key = await crypto.subtle.importKey('spki', der, { name: 'Ed25519' }, false, ['verify']);
  const signature = await crypto.subtle.verify('Ed25519', key, fromBase64(certificate.signature.value), fromHex(digest));
  const actualModel = profile.model_catalog[statement.model];
  const checks = {
    registered_key: `sha256:${await sha(encoder.encode(bundle.trusted_provider_public_key_pem))}` === bundle.trusted_provider_fingerprint,
    certificate_version: certificate.version === 'serving_certificate_v1' && certificate.signature_algorithm === 'ed25519' && certificate.digest_algorithm === 'sha256',
    request_commitment_scheme: statement.request_commitment_scheme === 'poseidon-hashout4-request-commitment-v1',
    request_id: statement.rid === bindings.request_id,
    actual_serving_model: typeof actualModel === 'string' && actualModel === example.forwardedApiRequest.model,
    model: actualModel === example.model,
    request_commitment: statement.request_commitment.length === 4
      && statement.request_commitment.every((limb) => BigInt(limb) >= 0n && BigInt(limb) < 18446744069414584321n),
    response_hash: statement.response_hash === `sha256:${responseHash}`,
    serving_digest: statement.serving_digest === `sha256:${digest}`,
    signature
  };
  return { valid: Object.values(checks).every(Boolean), checks };
}

self.onmessage = async ({ data }) => {
  if (data.type === 'warmup') {
    try { await fixture(); self.postMessage({ type: 'ready' }); }
    catch (error) { fixturePromise = null; self.postMessage({ type: 'error', message: String(error) }); }
    return;
  }
  const variant = data.variant;
  if (!['honest', 'request', 'response', 'selection', 'model'].includes(variant)) return;
  const result = { variant, runId: data.runId, proofs: {}, certificate: null, accept: false };
  try {
    const { bundle, profile, artifacts } = await fixture();
    const example = exampleFor(bundle, variant);
    const totalStarted = performance.now();
    for (const name of ['selection', 'rewrite']) {
      self.postMessage({ type: 'progress', runId: data.runId, variant, part: name });
      const bytes = artifacts[name].proof;
      const started = performance.now();
      try {
        const expectedInputs = bundle.proofs[name].public_inputs.slice();
        let bindingsValid = true;
        if (name === 'selection') {
          // Prove eligibility for the actual serving model, not the router's claimed name.
          expectedInputs[12] = example.certificate.statement.model;
          bindingsValid = await verifyEncoder(bundle, profile, example);
        }
        else {
          const clientHash = JSON.parse(hash_client_request(JSON.stringify(example.clientRequest)));
          expectedInputs[8] = String(example.clientRequest.length);
          expectedInputs.splice(9, 4, ...clientHash);
          expectedInputs[13] = String(example.forwardedApiRequest.messages.length);
          expectedInputs.splice(14, 4, ...example.certificate.statement.request_commitment);
        }
        const verified = JSON.parse(verify_proof(bytes, artifacts[name].verifier, JSON.stringify(expectedInputs)));
        result.proofs[name] = { valid: bindingsValid && verified.verified === true, milliseconds: performance.now() - started };
      } catch (error) {
        result.proofs[name] = { valid: false, milliseconds: performance.now() - started, reason: String(error) };
      }
    }
    self.postMessage({ type: 'progress', runId: data.runId, variant, part: 'certificate' });
    const certificateStarted = performance.now();
    result.certificate = await verifyServing(bundle, profile, example);
    result.certificate.milliseconds = performance.now() - certificateStarted;
    result.total_milliseconds = performance.now() - totalStarted;
    result.fixture_response = example.response;
    result.claimed_model = example.model;
    result.accept = result.proofs.selection.valid && result.proofs.rewrite.valid && result.certificate.valid;
    self.postMessage({ type: 'result', ...result });
  } catch (error) {
    fixturePromise = null;
    self.postMessage({ type: 'error', runId: data.runId, variant, message: String(error) });
  }
};
