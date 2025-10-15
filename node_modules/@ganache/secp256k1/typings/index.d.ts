/*!
 * @ganache/secp256k1
 *
 * @author David Murdoch
 * @license MIT
 */
/// <reference types="node" />
export declare const SECP256K1_N = 115792089237316195423570985008687907852837564279074904382605163141518161494337n;
export declare const SECP256K1_MAX_PRIVATE_KEY_DIV_2 = 57896044618658097711785492504343953926418782139537452191302581570759080747168n;
declare let secp256k1: {
    ecdsaRecover: (output: Uint8Array, signature: Uint8Array, recid: number, message: Uint8Array) => 0 | 1;
    publicKeyConvert: (output: Uint8Array, senderPubKey: Uint8Array) => 0 | 1 | 2;
    publicKeyCreate: (output: Uint8Array, secretKey: Buffer) => 0 | 1 | 2;
    privateKeyTweakAdd: (output: Uint8Array, secretKey: Buffer) => 0 | 1 | 2;
    ecdsaSign: (output: {
        signature: Uint8Array;
        recid: number;
    }, msgHash: Uint8Array, privateKey: Uint8Array) => 0 | 1;
};
export default secp256k1;
//# sourceMappingURL=index.d.ts.map