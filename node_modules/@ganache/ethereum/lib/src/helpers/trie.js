"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GanacheTrie = void 0;
const utils_1 = require("@ganache/utils");
const trie_1 = require("@ethereumjs/trie");
const keyHashingFunction = (msg) => {
    return (0, utils_1.keccak)(Buffer.from(msg.buffer, msg.byteOffset, msg.length));
};
class GanacheTrie extends trie_1.Trie {
    constructor(db, root, blockchain) {
        super({
            db,
            root,
            useRootPersistence: true,
            useKeyHashing: true,
            useKeyHashingFunction: keyHashingFunction
        });
        this.blockchain = blockchain;
        this.db = db;
    }
    setContext(stateRoot, address, blockNumber) {
        this.root(stateRoot);
    }
    /**
     * Returns a copy of the underlying trie with the interface of GanacheTrie.
     * @param includeCheckpoints - If true and during a checkpoint, the copy will contain the checkpointing metadata and will use the same scratch as underlying db.
     */
    copy(includeCheckpoints = true) {
        const secureTrie = new GanacheTrie(this.db.copy(), this.root(), this.blockchain);
        if (includeCheckpoints && this.hasCheckpoints()) {
            secureTrie._db.checkpoints = [...this._db.checkpoints];
        }
        return secureTrie;
    }
}
exports.GanacheTrie = GanacheTrie;
//# sourceMappingURL=trie.js.map