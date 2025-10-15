/// <reference types="node" />
import { Quantity } from "@ganache/utils";
import { Trie } from "@ethereumjs/trie";
import Blockchain from "../blockchain";
import { TrieDB } from "../trie-db";
export declare class GanacheTrie extends Trie {
    readonly blockchain: Blockchain;
    /**
     * The database that's returned from this.database() does not have all of
     * the types of the original input database because ethereumjs doesn't use
     * generics for their types in the underlying `CheckpointDB`. So, we store the
     * original db on our trie so we can access those types.
     */
    readonly db: TrieDB;
    constructor(db: TrieDB, root: Buffer, blockchain: Blockchain);
    setContext(stateRoot: Buffer, address: Buffer, blockNumber: Quantity): void;
    /**
     * Returns a copy of the underlying trie with the interface of GanacheTrie.
     * @param includeCheckpoints - If true and during a checkpoint, the copy will contain the checkpointing metadata and will use the same scratch as underlying db.
     */
    copy(includeCheckpoints?: boolean): GanacheTrie;
}
//# sourceMappingURL=trie.d.ts.map