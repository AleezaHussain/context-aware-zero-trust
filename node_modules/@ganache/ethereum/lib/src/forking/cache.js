"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ForkCache = void 0;
const util_1 = require("@ethereumjs/util");
const cache_1 = require("@ethereumjs/statemanager/dist/cache");
class ForkCache extends cache_1.Cache {
    constructor(trie) {
        /**
         * Looks up address in underlying trie.
         * @param address - Address of account
         */
        const lookupAccount = async (address) => {
            const rlp = await trie.get(address.buf);
            return rlp ? util_1.Account.fromRlpSerializedAccount(rlp) : new util_1.Account();
        };
        super({ getCb: lookupAccount, putCb: trie.put.bind(trie), deleteCb: trie.del.bind(trie) });
    }
}
exports.ForkCache = ForkCache;
//# sourceMappingURL=cache.js.map