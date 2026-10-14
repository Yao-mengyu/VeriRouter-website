import init, { verify_proof } from './assets/zk/verifier.js';

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
async function loadBytes(file) {
  const response = await fetch(new URL(`./assets/zk/${file}`, import.meta.url));
  if (!response.ok) throw new Error(`Unable to load ${file} (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}
let fixturePromise;
async function fixture() {
  fixturePromise ||= (async () => {
    const response = await fetch(new URL('./assets/zk/bundle.json', import.meta.url));
    if (!response.ok) throw new Error('Unable to load the public fixture');
    const bundle = await response.json();
    await init({ module_or_path: await loadBytes('verifier_bg.wasm') });
    const artifacts = {};
    for (const name of ['selection', 'rewrite']) {
      const record = bundle.proofs[name];
      const [proof, verifier] = await Promise.all([loadBytes(record.proof), loadBytes(record.verifier)]);
      if (await sha(verifier) !== record.verifier_sha256) throw new Error(`Pinned ${name} verifier key mismatch`);
      artifacts[name] = { proof, verifier };
    }
    return { bundle, artifacts };
  })();
  return fixturePromise;
}

async function generatedFixture(data, pinned) {
  const url = new URL(data.bundleUrl, import.meta.url);
  if (url.origin !== self.location.origin || !/\/api\/jobs\/[a-f0-9-]{36}\/bundle\.json$/.test(url.pathname)) throw new Error('Invalid proof-run URL');
  const response = await fetch(url);
  if (!response.ok) throw new Error('Unable to load the generated evidence');
  const bundle = await response.json();
  if (bundle.bindings.request_id !== data.requestId) throw new Error('Request ID mismatch');
  if (bundle.trusted_provider_public_key_pem !== data.providerKey) throw new Error('Demo issuer key mismatch');
  const artifacts = {};
  for (const name of ['selection', 'rewrite']) {
    const record = bundle.proofs[name];
    const reference = pinned.bundle.proofs[name];
    const fixedLength = name === 'selection' ? 17 : 14;
    if (record.public_inputs.length !== reference.public_inputs.length ||
      !same(record.public_inputs.slice(0, fixedLength), reference.public_inputs.slice(0, fixedLength))) throw new Error(`Unexpected ${name} public statement`);
    const load = async (extension) => {
      const res = await fetch(new URL(`${name}.${extension}`, url));
      if (!res.ok) throw new Error(`Unable to load generated ${name} ${extension}`);
      return new Uint8Array(await res.arrayBuffer());
    };
    const [proof, verifier] = await Promise.all([load('proof'), load('verifier')]);
    if (await sha(verifier) !== reference.verifier_sha256) throw new Error(`Pinned ${name} verifier key mismatch`);
    artifacts[name] = { proof, verifier };
  }
  return { bundle, artifacts };
}

async function verifyServing(bundle, variant) {
  const certificate = bundle.certificate;
  const statement = certificate.statement;
  const bindings = bundle.bindings;
  const response = variant === 'response' ? `${bundle.response} Tampered.` : bundle.response;
  const model = variant === 'model' ? 'forged-model' : bindings.selected_model;
  const responseHash = await sha(encoder.encode(JSON.stringify(response)));
  const commitment = new Uint8Array(32);
  const view = new DataView(commitment.buffer);
  statement.request_commitment.forEach((limb, index) => view.setBigUint64(index * 8, BigInt(limb), false));
  const digest = await sha(concatenate(
    encoder.encode('VeriRouter.serving-certificate.v1'),
    field(encoder.encode(statement.rid)),
    field(encoder.encode(statement.model)),
    field(commitment),
    field(fromHex(statement.response_hash.slice(7)))
  ));
  const der = fromBase64(bundle.trusted_provider_public_key_pem.replace(/-----[^-]+-----|\s/g, ''));
  const key = await crypto.subtle.importKey('spki', der, { name: 'Ed25519' }, false, ['verify']);
  const signature = await crypto.subtle.verify('Ed25519', key, fromBase64(certificate.signature.value), fromHex(digest));
  const selectionInputs = bundle.proofs.selection.public_inputs;
  const rewriteInputs = bundle.proofs.rewrite.public_inputs;
  const checks = {
    registered_key: `sha256:${await sha(encoder.encode(bundle.trusted_provider_public_key_pem))}` === bundle.trusted_provider_fingerprint,
    certificate_version: certificate.version === 'serving_certificate_v1' && certificate.signature_algorithm === 'ed25519' && certificate.digest_algorithm === 'sha256',
    request_commitment_scheme: statement.request_commitment_scheme === 'poseidon-hashout4-request-commitment-v1',
    request_id: statement.rid === bindings.request_id,
    model: statement.model === model && selectionInputs[12] === model,
    client_request: same(bindings.route_client_request_hash, bindings.rewrite_client_request_hash) && same(rewriteInputs.slice(9, 13), bindings.rewrite_client_request_hash),
    query: same(selectionInputs.slice(4, 8), bindings.route_query_hash),
    request_commitment: same(statement.request_commitment, bindings.rewrite_request_commitment) && same(rewriteInputs.slice(14, 18), statement.request_commitment),
    response_hash: statement.response_hash === `sha256:${responseHash}`,
    serving_digest: statement.serving_digest === `sha256:${digest}`,
    signature
  };
  return { valid: Object.values(checks).every(Boolean), checks };
}

self.onmessage = async ({ data }) => {
  const variant = data.variant;
  const result = { variant, proofs: {}, certificate: null, accept: false };
  try {
    const pinned = await fixture();
    const { bundle, artifacts } = data.bundleUrl ? await generatedFixture(data, pinned) : pinned;
    for (const name of ['selection', 'rewrite']) {
      self.postMessage({ type: 'progress', variant, part: name });
      const bytes = artifacts[name].proof.slice();
      if (variant === name) bytes[Math.floor(bytes.length / 2)] ^= 1;
      const started = performance.now();
      try {
        const verified = JSON.parse(verify_proof(bytes, artifacts[name].verifier, JSON.stringify(bundle.proofs[name].public_inputs)));
        result.proofs[name] = { valid: verified.verified === true, milliseconds: performance.now() - started };
      } catch (error) {
        result.proofs[name] = { valid: false, milliseconds: performance.now() - started, reason: String(error) };
      }
    }
    self.postMessage({ type: 'progress', variant, part: 'certificate' });
    result.certificate = await verifyServing(bundle, variant);
    result.fixture_response = variant === 'response' ? `${bundle.response} Tampered.` : bundle.response;
    result.claimed_model = variant === 'model' ? 'forged-model' : bundle.bindings.selected_model;
    result.accept = result.proofs.selection.valid && result.proofs.rewrite.valid && result.certificate.valid;
    self.postMessage({ type: 'result', ...result });
  } catch (error) {
    fixturePromise = null;
    self.postMessage({ type: 'error', variant, message: String(error) });
  }
};
