use plonky2::field::goldilocks_field::GoldilocksField;
use plonky2::field::types::PrimeField64;
use plonky2::plonk::circuit_data::VerifierCircuitData;
use plonky2::plonk::config::PoseidonGoldilocksConfig;
use plonky2::plonk::proof::ProofWithPublicInputs;
use plonky2::util::serialization::DefaultGateSerializer;
use wasm_bindgen::prelude::*;

type F = GoldilocksField;
type C = PoseidonGoldilocksConfig;
const D: usize = 2;

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
