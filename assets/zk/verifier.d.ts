/* tslint:disable */
/* eslint-disable */

/**
 * Used only when preparing the fixed, trusted fixture manifest offline.
 */
export function decode_public_inputs(proof_bytes: Uint8Array, verifier_bytes: Uint8Array): string;

/**
 * Match the release's ordered UTF-8 request hash, including roles and message count.
 */
export function hash_client_request(messages_json: string): string;

/**
 * Match the quantized-query commitment in the release's routing circuit.
 */
export function hash_query(vector_json: string, zero_point: number): string;

/**
 * Verify actual Plonky2 proof bytes under a pinned key and pinned public inputs.
 */
export function verify_proof(proof_bytes: Uint8Array, verifier_bytes: Uint8Array, expected_inputs: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly decode_public_inputs: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly hash_client_request: (a: number, b: number) => [number, number, number, number];
    readonly hash_query: (a: number, b: number, c: number) => [number, number, number, number];
    readonly verify_proof: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
