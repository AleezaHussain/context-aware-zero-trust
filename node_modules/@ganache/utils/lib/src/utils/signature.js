"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ecsignLegacy = exports.ecsign = void 0;
const secp256k1_1 = __importDefault(require("@ganache/secp256k1"));
function ecsign(msgHash, privateKey) {
    const output = {
        signature: new Uint8Array(64),
        recid: null
    };
    const status = secp256k1_1.default.ecdsaSign(output, msgHash, privateKey);
    if (status !== 0) {
        throw new Error("The nonce generation function failed, or the private key was invalid");
    }
    const { signature, recid } = output;
    const buffer = signature.buffer;
    const r = Buffer.from(buffer, 0, 32);
    const s = Buffer.from(buffer, 32, 32);
    const v = BigInt(recid);
    return { r, s, v };
}
exports.ecsign = ecsign;
function ecsignLegacy(msgHash, privateKey, chainId) {
    const { v, r, s } = ecsign(msgHash, privateKey);
    const legacyV = chainId === undefined ? v + 27n : v + 35n + BigInt(chainId) * 2n;
    return { r, s, v: legacyV };
}
exports.ecsignLegacy = ecsignLegacy;
//# sourceMappingURL=signature.js.map