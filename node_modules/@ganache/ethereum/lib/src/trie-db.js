"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrieDB = void 0;
const subleveldown_1 = __importDefault(require("subleveldown"));
const ENCODING_OPTS = { keyEncoding: "binary", valueEncoding: "binary" };
/**
 * `@ethereumjs/trie` requires that any database passed to it implements a `DB`.
 * The `DB` interface defines the minimum set of database access methods that
 * ethereumjs needs internally. We implement that interface in `TrieDB`, as well
 * as a few other methods that we use in Ganache internally.
 */
class TrieDB {
    constructor(db) {
        this._db = db;
    }
    async get(key) {
        let value = null;
        try {
            value = await this._db.get(key, ENCODING_OPTS);
        }
        catch (error) {
            if (error.notFound) {
                // not found, returning null
            }
            else {
                throw error;
            }
        }
        return value;
    }
    async put(key, val) {
        await this._db.put(key, val, ENCODING_OPTS);
    }
    async del(key) {
        await this._db.del(key, ENCODING_OPTS);
    }
    async batch(opStack) {
        await this._db.batch(opStack, ENCODING_OPTS);
    }
    copy() {
        return new TrieDB(this._db);
    }
    async close() {
        await this._db.close();
    }
    sublevel(prefix, options) {
        return (0, subleveldown_1.default)(this._db, prefix, options);
    }
    createReadStream(options) {
        return this._db.createReadStream(options);
    }
}
exports.TrieDB = TrieDB;
//# sourceMappingURL=trie-db.js.map