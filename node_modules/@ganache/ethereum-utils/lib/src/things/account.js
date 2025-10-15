"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Account = void 0;
const utils_1 = require("@ganache/utils");
const util_1 = require("@ethereumjs/util");
const rlp_1 = require("@ganache/rlp");
class Account {
    constructor(address) {
        this.storageRoot = util_1.KECCAK256_RLP;
        this.codeHash = util_1.KECCAK256_NULL;
        this.address = address;
        this.balance = utils_1.Quantity.Empty;
        this.nonce = utils_1.Quantity.Empty;
    }
    static fromBuffer(buffer) {
        const account = Object.create(Account.prototype);
        const raw = (0, rlp_1.decode)(buffer);
        account.nonce = utils_1.Quantity.from(raw[0]);
        account.balance = utils_1.Quantity.from(raw[1]);
        account.storageRoot = raw[2];
        account.codeHash = raw[3];
        return account;
    }
    serialize() {
        return (0, rlp_1.encode)([
            this.nonce.toBuffer(),
            this.balance.toBuffer(),
            this.storageRoot,
            this.codeHash
        ]);
    }
}
exports.Account = Account;
//# sourceMappingURL=account.js.map