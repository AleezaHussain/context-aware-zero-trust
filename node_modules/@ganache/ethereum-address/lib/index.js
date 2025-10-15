"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Address = void 0;
const util_1 = require("@ethereumjs/util");
const utils_1 = require("@ganache/utils");
class Address extends util_1.Address {
    constructor(value) {
        super(value);
    }
    static from(value) {
        return new Address(utils_1.Data.toBuffer(value, Address.ByteLength));
    }
    static toBuffer(value) {
        return Address.from(value).toBuffer();
    }
    static toString(value) {
        return Address.from(value).toString();
    }
    toJSON() {
        return this.toString();
    }
}
exports.Address = Address;
Address.ByteLength = 20;
//# sourceMappingURL=index.js.map