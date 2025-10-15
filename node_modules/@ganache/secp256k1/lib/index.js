"use strict";
/*!
 * @ganache/secp256k1
 *
 * @author David Murdoch
 * @license MIT
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SECP256K1_MAX_PRIVATE_KEY_DIV_2 = exports.SECP256K1_N = void 0;
const path_1 = require("path");
exports.SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
exports.SECP256K1_MAX_PRIVATE_KEY_DIV_2 = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n; // (SECP256K1_N - 1n) / 2n
let secp256k1;
try {
    // TODO: find a better way :-)
    // use `eval` to make `ganache`'s webpack ignore this
    const nodeRequire = eval("require");
    const path = nodeRequire.resolve("secp256k1/package.json");
    const dir = (0, path_1.dirname)(path);
    const nodeGypBuild = require("node-gyp-build");
    // load native secp256k1
    const { Secp256k1 } = nodeGypBuild(dir);
    secp256k1 = new Secp256k1();
}
catch {
    // on error use the JS fallback
    secp256k1 = require("secp256k1/lib/elliptic");
}
exports.default = secp256k1;
//# sourceMappingURL=index.js.map