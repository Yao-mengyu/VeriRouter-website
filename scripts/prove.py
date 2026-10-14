"""Prove the recorded medical example with the release's small demo circuits."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def strings(values):
    return [str(value) for value in values]


def public_certificate(payload):
    certificate = {key: copy.deepcopy(payload[key]) for key in
                   ["version", "signature_algorithm", "digest_algorithm", "statement", "signature"]}
    certificate["statement"]["request_commitment"] = strings(certificate["statement"]["request_commitment"])
    return certificate


def medical_fixture(demo):
    project = Path(__file__).resolve().parents[1]
    profile = json.loads((project / "data/verifier-profile.json").read_text())
    trace = json.loads((project / "data/demo-trace.json").read_text())
    recorded = trace["cases"]["response"]
    client_request = demo.chain.normalize_client_request(recorded["client_request"])
    question = str(profile["question"])
    if client_request != profile["client_request"] or client_request != [{"role": "user", "content": question}]:
        raise ValueError("The recorded request must match the pinned medical query lookup")
    model_id = str(profile["selected_model_id"])
    selected_model_name = profile["model_catalog"][model_id]
    if recorded["honest_response"]["model"] != selected_model_name:
        raise ValueError("The recorded model must match the trusted demo catalog")
    forwarded = recorded["normal_forwarded_request"]["messages"]
    if len(forwarded) != 2 or forwarded[0]["role"] != "system" or forwarded[1:] != client_request:
        raise ValueError("Expected the recorded system message followed by the client request")

    route_input = demo.read_bin(demo.default_route_input("small"))
    route_trace = demo.read_bin(demo.resolve_repo_path(route_input["proof_input_path"]))
    if (route_trace["query"]["vector_u16"] != profile["query_vector"]
            or route_trace["quantizer"]["zero_point"] != profile["zero_point"]
            or str(route_trace["selected_model_id"]) != model_id):
        raise ValueError("The small routing fixture must match the pinned demo query and catalog")

    rewrite_input = demo.read_bin(demo.default_rewrite_input("small"))
    commit = rewrite_input.setdefault("commit", {})
    commit["msg_list"][0] = copy.deepcopy(forwarded[0])
    commit["request_randomness"] = demo.fresh_poseidon_randomness()
    first, *padding = rewrite_input["messages"]
    first.update(role="user", content=question, present=True,
                 gap_before=[{"ref": 0}], prefixes=[], suffixes=[])
    for message in padding:
        message.update(content="", present=False, gap_before=[], prefixes=[], suffixes=[])
    rewrite_input["trailing_gap"] = []
    rewrite_input["source"] = {"trace": "data/demo-trace.json", "case": "response",
                               "routing_fixture": "examples/route_input_small.bin"}
    original, executed = demo.chain.resolve_rewrite_input(rewrite_input)
    if original != client_request or executed != forwarded:
        raise ValueError("The rewrite fixture must reproduce the recorded normal request exactly")

    response_variants = {}
    for variant, source_case in [("response", "response"), ("model", "identity")]:
        delivered = trace["cases"][source_case]["delivered_response"]
        response_variants[variant] = {"model": delivered["model"], "response": delivered["content"]}
    request_attack = trace["cases"]["request"]
    if demo.chain.normalize_client_request(request_attack["client_request"]) != client_request:
        raise ValueError("The injection scenario must preserve the same client question")
    attack_forwarded = copy.deepcopy(request_attack["attack_forwarded_request"])
    if (attack_forwarded["model"] != selected_model_name
            or [message for message in attack_forwarded["messages"] if message["role"] == "user"] != client_request
            or attack_forwarded["messages"] == forwarded):
        raise ValueError("Expected an injected system instruction with the same model and client question")
    return {"profile": profile, "route_input": route_input, "rewrite_input": rewrite_input,
            "client_request": client_request, "question": question,
            "client_api_request": copy.deepcopy(recorded["client_request"]),
            "forwarded_api_request": copy.deepcopy(recorded["normal_forwarded_request"]),
            "selected_model_name": selected_model_name,
            "response": {"backend_id": model_id, "response": recorded["honest_response"]["content"]},
            "request_variant": {"forwarded_api_request": attack_forwarded,
                                "response": request_attack["attack_backend_response"]["content"]},
            "response_variants": response_variants}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--rid", required=True)
    parser.add_argument("--key", required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(Path(args.artifact).resolve()))
    from scripts import demo

    binaries = [demo.ROUTE_BINARY, demo.REWRITE_BINARY, demo.SIGNATURE_BINARY]
    if not all(binary.is_file() for binary in binaries):
        demo.build_rust_binaries()

    def use_demo_issuer(namespace):
        shutil.copyfile(args.key, namespace.private_key)
        os.chmod(namespace.private_key, 0o600)
        subprocess.run(["openssl", "pkey", "-in", args.key, "-pubout", "-out", namespace.public_key],
                       check=True, capture_output=True)

    demo.signature.init_keypair = use_demo_issuer
    fixture = medical_fixture(demo)
    profile = fixture["profile"]
    demo.PUBLIC_ENCODER_ID = profile["encoder_id"]
    response = fixture["response"]
    out = Path(args.out).resolve()
    demo.run_component(out_dir=out, rid=args.rid, rewrite_input=fixture["rewrite_input"],
                       route_input=fixture["route_input"],
                       response_payload=response, parallelism=int(os.environ.get("PROVER_THREADS", "4")))

    load = lambda name: json.loads((out / name).read_text())
    manifest = load("chain_manifest.json")
    if not manifest["accept"] or not all(manifest["checks"].values()):
        raise RuntimeError("The native evidence-chain verifier rejected the generated proofs")
    route, rewrite = load("route_certificate.json"), load("rewrite_certificate.json")
    rs, ws = route["route_statement"], rewrite["rewrite_statement"]
    route_inputs = (rs["reference_commitment"] + rs["q_hash"] + rs["graph_commitment"]
                    + [rs[key] for key in ["output_model_id", "entry_point", "entry_layer", "ef_search", "top_k"]])
    rewrite_inputs = (ws["message_bank_commitment"] + ws["fragment_bank_commitment"]
                      + [ws["client_message_count"]] + ws["client_request_hash"]
                      + [ws["rewritten_message_count"]] + ws["request_commitment"])
    public = out / "public"
    public.mkdir()
    proofs = {}
    for name, certificate, inputs in [("selection", route, route_inputs), ("rewrite", rewrite, rewrite_inputs)]:
        verified = certificate["proof_verification"]
        if not verified["zero_knowledge"] or not verified["verified"]:
            raise RuntimeError("Expected a verified zero-knowledge proof")
        proof, verifier = f"{name}.proof", f"{name}.verifier"
        shutil.copyfile(verified["proof_path"], public / proof)
        verifier_bytes = bytes.fromhex(verified["verifier_data_hex"])
        (public / verifier).write_bytes(verifier_bytes)
        proofs[name] = {"proof": proof, "verifier": verifier,
                        "verifier_sha256": hashlib.sha256(verifier_bytes).hexdigest(),
                        "public_inputs": strings(inputs)}
    certificate = public_certificate(load("execution_certificate.json"))
    request_variant = fixture["request_variant"]
    request_randomness = fixture["rewrite_input"]["commit"]["request_randomness"]
    attack_messages = request_variant["forwarded_api_request"]["messages"]
    attack_commitment = demo.compute_request_commitment_report(
        attack_messages, request_randomness=request_randomness, chunk_bytes=8,
        request_commitment_bin=str(demo.SIGNATURE_BINARY),
    )["request_commitment"]
    if strings(attack_commitment) == certificate["statement"]["request_commitment"]:
        raise RuntimeError("The injected request must have a different serving commitment")
    attack_certificate_path = out / "attack-request-certificate.json"
    demo.issue_execution_certificate_inline(
        private_key=out / "backend_ed25519.pem", public_key=out / "backend_ed25519.pub.pem",
        rid=args.rid, model=str(rs["output_model_id"]), received_request=attack_messages,
        request_randomness=request_randomness, chunk_bytes=8,
        expected_request_commitment=attack_commitment,
        response_text=request_variant["response"], out=attack_certificate_path,
    )
    attack_certificate = load("attack-request-certificate.json")
    if attack_certificate["verification"]["verified"] is not True:
        raise RuntimeError("The injected request's serving certificate signature must verify")
    request_variant["certificate"] = public_certificate(attack_certificate)
    public_key = (out / "backend_ed25519.pub.pem").read_text()
    encoder_statement = copy.deepcopy(route["encoder_statement"])
    for name in ["client_request_hash", "route_query_hash"]:
        encoder_statement[name] = strings(encoder_statement[name])
    bundle = {
        "version": "verirouter-browser-fixture/v1", "proofs": proofs, "certificate": certificate,
        "trusted_provider_public_key_pem": public_key,
        "trusted_provider_fingerprint": "sha256:" + hashlib.sha256(public_key.encode()).hexdigest(),
        "response": str(response["response"]),
        "question": fixture["question"],
        "client_request": fixture["client_request"],
        "client_api_request": fixture["client_api_request"],
        "forwarded_api_request": fixture["forwarded_api_request"],
        "model_catalog": profile["model_catalog"],
        "selected_model_name": fixture["selected_model_name"],
        "response_variants": fixture["response_variants"],
        "request_variant": request_variant,
        "encoder_statement": encoder_statement,
        "query_vector": profile["query_vector"],
        "zero_point": profile["zero_point"],
        "bindings": {"request_id": args.rid, "selected_model": str(rs["output_model_id"]),
                     "route_client_request_hash": strings(route["client_request_hash"]),
                     "rewrite_client_request_hash": strings(ws["client_request_hash"]),
                     "rewrite_request_commitment": strings(ws["request_commitment"]),
                     "route_query_hash": strings(rs["q_hash"])},
        "native_chain_checks": manifest["checks"],
    }
    (public / "bundle.json").write_text(json.dumps(bundle, indent=2) + "\n")
    print("WEB_PROOFS_READY", flush=True)


if __name__ == "__main__":
    main()
