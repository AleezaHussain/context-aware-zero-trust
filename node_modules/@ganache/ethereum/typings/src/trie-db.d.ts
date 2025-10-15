/// <reference types="node" />
/// <reference types="node" />
import type { BatchDBOp, DB } from "@ethereumjs/trie";
import type { AbstractIteratorOptions } from "abstract-level";
import { GanacheLevelUp } from "./database";
/**
 * `@ethereumjs/trie` requires that any database passed to it implements a `DB`.
 * The `DB` interface defines the minimum set of database access methods that
 * ethereumjs needs internally. We implement that interface in `TrieDB`, as well
 * as a few other methods that we use in Ganache internally.
 */
export declare class TrieDB implements DB {
    readonly _db: GanacheLevelUp;
    constructor(db: GanacheLevelUp);
    get(key: Buffer): Promise<Buffer | null>;
    put(key: Buffer, val: Buffer): Promise<void>;
    del(key: Buffer): Promise<void>;
    batch(opStack: BatchDBOp[]): Promise<void>;
    copy(): TrieDB;
    close(): Promise<void>;
    sublevel(prefix: string, options: object): GanacheLevelUp;
    createReadStream(options?: AbstractIteratorOptions<Buffer, Buffer>): NodeJS.ReadableStream;
}
//# sourceMappingURL=trie-db.d.ts.map