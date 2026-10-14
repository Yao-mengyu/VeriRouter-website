use plonky2::field::goldilocks_field::GoldilocksField;
use plonky2::field::types::{Field, PrimeField64};
use plonky2::hash::hash_types::HashOut;
use plonky2::hash::hashing::PlonkyPermutation;
use plonky2::hash::poseidon::{PoseidonHash, PoseidonPermutation};
use plonky2::plonk::circuit_data::VerifierCircuitData;
use plonky2::plonk::config::{Hasher, PoseidonGoldilocksConfig};
use plonky2::plonk::proof::ProofWithPublicInputs;
use plonky2::util::serialization::DefaultGateSerializer;
use wasm_bindgen::prelude::*;

type F = GoldilocksField;
type C = PoseidonGoldilocksConfig;
const D: usize = 2;

fn hash(inputs: &[u64]) -> HashOut<F> {
    PoseidonHash::hash_no_pad(&inputs.iter().map(|x| F::from_canonical_u64(*x)).collect::<Vec<_>>())
}

fn serialize_hash(value: HashOut<F>) -> Result<String, JsValue> {
    let limbs: Vec<String> = value.elements.iter().map(|x| x.to_canonical_u64().to_string()).collect();
    serde_json::to_string(&limbs).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Match the release's ordered UTF-8 request hash, including roles and message count.
#[wasm_bindgen]
pub fn hash_client_request(messages_json: &str) -> Result<String, JsValue> {
    let messages: Vec<serde_json::Value> = serde_json::from_str(messages_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid request: {e}")))?;
    let mut transcript = hash(&[6, 0]);
    for message in &messages {
        let role = match message["role"].as_str() {
            Some("system") => 0,
            Some("user") => 1,
            Some("assistant") => 2,
            _ => return Err(JsValue::from_str("Unsupported message role")),
        };
        let content = message["content"].as_str()
            .ok_or_else(|| JsValue::from_str("Message content must be a string"))?;
        let bytes = content.as_bytes();
        let mut content_hash = hash(&[1, bytes.len() as u64, 0]);
        for byte in bytes {
            let mut inputs = vec![5];
            inputs.extend(content_hash.elements.iter().map(|x| x.to_canonical_u64()));
            inputs.extend([1, *byte as u64]);
            content_hash = hash(&inputs);
        }
        let mut inputs = vec![2, role, bytes.len() as u64];
        inputs.extend(content_hash.elements.iter().map(|x| x.to_canonical_u64()));
        let leaf = hash(&inputs);
        let mut permutation = PoseidonPermutation::new(core::iter::repeat(F::ZERO));
        permutation.set_from_slice(&transcript.elements, 0);
        permutation.set_from_slice(&leaf.elements, 4);
        permutation.set_elt(F::from_canonical_u64(7), 8);
        permutation.permute();
        transcript = HashOut { elements: std::array::from_fn(|i| permutation.squeeze()[i]) };
    }
    let mut inputs = vec![0x5652_5f52_4551_0008, messages.len() as u64];
    inputs.extend(transcript.elements.iter().map(|x| x.to_canonical_u64()));
    serialize_hash(hash(&inputs))
}

/// Match the quantized-query commitment in the release's routing circuit.
#[wasm_bindgen]
pub fn hash_query(vector_json: &str, zero_point: u32) -> Result<String, JsValue> {
    let vector: Vec<u16> = serde_json::from_str(vector_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid quantized query: {e}")))?;
    if vector.is_empty() || zero_point > u16::MAX as u32 {
        return Err(JsValue::from_str("Invalid quantized query dimensions or zero point"));
    }
    let mut inputs = vec![0x5155_4552_595f_5631, vector.len() as u64, zero_point as u64];
    inputs.extend(vector.iter().map(|x| *x as u64));
    serialize_hash(hash(&inputs))
}

fn decode(verifier: &[u8], bytes: &[u8]) -> Result<(VerifierCircuitData<F, C, D>, ProofWithPublicInputs<F, C, D>), JsValue> {
    let data = VerifierCircuitData::<F, C, D>::from_bytes(verifier.to_vec(), &DefaultGateSerializer)
        .map_err(|e| JsValue::from_str(&format!("Invalid verifier data: {e:?}")))?;
    if !data.common.config.zero_knowledge {
        return Err(JsValue::from_str("Pinned verifier must enable zero-knowledge mode"));
    }
    let proof = ProofWithPublicInputs::<F, C, D>::from_bytes(bytes.to_vec(), &data.common)
        .map_err(|e| JsValue::from_str(&format!("Invalid proof encoding: {e:?}")))?;
    Ok((data, proof))
}

/// Used only when preparing the fixed, trusted fixture manifest offline.
#[wasm_bindgen]
pub fn decode_public_inputs(proof_bytes: &[u8], verifier_bytes: &[u8]) -> Result<String, JsValue> {
    let (_, proof) = decode(verifier_bytes, proof_bytes)?;
    let values: Vec<String> = proof.public_inputs.iter().map(|x| x.to_canonical_u64().to_string()).collect();
    serde_json::to_string(&values).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Verify actual Plonky2 proof bytes under a pinned key and pinned public inputs.
#[wasm_bindgen]
pub fn verify_proof(proof_bytes: &[u8], verifier_bytes: &[u8], expected_inputs: &str) -> Result<String, JsValue> {
    let (data, proof) = decode(verifier_bytes, proof_bytes)?;
    let expected: Vec<String> = serde_json::from_str(expected_inputs)
        .map_err(|e| JsValue::from_str(&format!("Invalid pinned inputs: {e}")))?;
    let actual: Vec<String> = proof.public_inputs.iter().map(|x| x.to_canonical_u64().to_string()).collect();
    if expected.is_empty() || actual != expected {
        return Err(JsValue::from_str("Proof public inputs do not match the pinned fixture statement"));
    }
    data.verify(proof).map_err(|e| JsValue::from_str(&format!("ZK proof rejected: {e}")))?;
    Ok(serde_json::json!({"verified":true,"public_inputs_match":true,"zero_knowledge":true,"public_inputs_count":actual.len()}).to_string())
}
