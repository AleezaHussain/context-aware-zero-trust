pragma circom 2.1.6;

include "node_modules/circomlib/circuits/poseidon.circom";

template ContextPolicy() {
    // Private inputs
    signal input status_active;    // 0/1
    signal input zone3;            // 0/1
    signal input role_envsensor;   // 0/1
    signal input salt[32];         // 32 bytes (as field elems 0..255)
    signal input tsTrunc_min;      // e.g., minutes since epoch (integer)
    signal input ctAttrHash;       // field (hash of IPE ciphertext bytes)
    signal input ctNumHash;        // field (hash of HE ciphertext bytes)

    // Public inputs
    signal input C_t_public;       // Poseidon commitment
    signal input windowTag;        // minutes since epoch (bucket)

    // 1) Policy checks (strict)
    status_active === 1;
    zone3         === 1;
    role_envsensor=== 1;

    // 2) freshness equality
    tsTrunc_min === windowTag;

    // 3) Build Poseidon on all parts:
    component Hsalt = Poseidon(33); // 32 bytes + 1 length tag
    for (var i = 0; i < 32; i++) {
        Hsalt.inputs[i] <== salt[i];
    }
    Hsalt.inputs[32] <== 32;

    component Hctx = Poseidon(5);
    Hctx.inputs[0] <== Hsalt.out;
    Hctx.inputs[1] <== tsTrunc_min;
    Hctx.inputs[2] <== ctAttrHash;
    Hctx.inputs[3] <== ctNumHash;
    Hctx.inputs[4] <== 123456789; // domain-sep tag

    C_t_public === Hctx.out;
}

component main = ContextPolicy();
