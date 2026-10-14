"""Run the release's small ZK demo and export only public evidence."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def strings(values):
    return [str(value) for value in values]


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
    rewrite_input = demo.read_bin(demo.default_rewrite_input("small"))
    # Keep the endorsed banks fixed; freshly blind this serving request.
    rewrite_input.setdefault("commit", {})["request_randomness"] = demo.fresh_poseidon_randomness()
    response = demo.read_bin(demo.ROOT / "examples/response.bin")
    out = Path(args.out).resolve()
    demo.run_component(out_dir=out, rid=args.rid, rewrite_input=rewrite_input,
                       route_input=demo.read_bin(demo.default_route_input("small")),
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
    cert = load("execution_certificate.json")
    certificate = {key: cert[key] for key in ["version", "signature_algorithm", "digest_algorithm", "statement", "signature"]}
    certificate["statement"]["request_commitment"] = strings(certificate["statement"]["request_commitment"])
    public_key = (out / "backend_ed25519.pub.pem").read_text()
    bundle = {
        "version": "verirouter-browser-fixture/v1", "proofs": proofs, "certificate": certificate,
        "trusted_provider_public_key_pem": public_key,
        "trusted_provider_fingerprint": "sha256:" + hashlib.sha256(public_key.encode()).hexdigest(),
        "response": str(response["response"]),
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
