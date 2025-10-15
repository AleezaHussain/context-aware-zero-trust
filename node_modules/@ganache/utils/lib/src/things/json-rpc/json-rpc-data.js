"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Data = void 0;
const json_rpc_base_types_1 = require("./json-rpc-base-types");
const constants_1 = require("../../utils/constants");
class Data extends json_rpc_base_types_1.BaseJsonRpcType {
    constructor(value, _byteLength) {
        super(value);
        this._byteLength = _byteLength;
        if (typeof value === "bigint") {
            throw new Error(`Cannot create a ${typeof value} as a Data`);
        }
    }
    toString(byteLength) {
        const length = byteLength || this._byteLength;
        if (this.bufferValue == null) {
            return "0x";
        }
        if (length === undefined) {
            return super.toString();
        }
        const strValue = this.bufferValue.toString("hex");
        return `0x${Data.stringToFixedByteLength(strValue, length)}`;
    }
    toBuffer(byteLength) {
        if (this.bufferValue == null) {
            return constants_1.BUFFER_EMPTY;
        }
        const length = byteLength || this._byteLength;
        if (length == undefined || length === this.bufferValue.length) {
            return this.bufferValue;
        }
        return Data.bufferToFixedByteLength(this.bufferValue, length);
    }
    static from(value, byteLength) {
        return new Data(value, byteLength);
    }
    static stringToFixedByteLength(value, byteLength) {
        const desiredCharLength = byteLength * 2;
        if (desiredCharLength === value.length) {
            return value;
        }
        const padCharCount = desiredCharLength - value.length;
        let fixedLengthValue;
        if (padCharCount > 0) {
            fixedLengthValue = "0".repeat(padCharCount) + value;
        }
        else {
            fixedLengthValue = value.slice(0, desiredCharLength);
        }
        return fixedLengthValue;
    }
    static bufferToFixedByteLength(value, byteLength) {
        if (byteLength === value.length) {
            return value;
        }
        const fixedLengthValue = Buffer.allocUnsafe(byteLength);
        const sourceStart = 0;
        const targetStart = value.length > byteLength ? 0 : byteLength - value.length;
        if (targetStart > 0) {
            fixedLengthValue.fill(0, 0, targetStart);
        }
        value.copy(fixedLengthValue, targetStart, sourceStart, byteLength);
        return fixedLengthValue;
    }
    static toBuffer(value, byteLength) {
        return Data.from(value, byteLength).toBuffer();
    }
    static toString(value, byteLength) {
        return Data.from(value, byteLength).toString();
    }
}
exports.Data = Data;
Data.Empty = Data.from(constants_1.BUFFER_EMPTY);
//# sourceMappingURL=json-rpc-data.js.map