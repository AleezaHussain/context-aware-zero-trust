/// <reference types="node" />
import { BaseJsonRpcType } from "./json-rpc-base-types";
import { JsonRpcInputArg } from "./input-parsers";
export declare class Quantity extends BaseJsonRpcType {
    static Empty: Quantity;
    static Zero: Quantity;
    static One: Quantity;
    static Gwei: Quantity;
    private static ZERO_VALUE_STRING;
    _nullable: boolean;
    static from(value: JsonRpcInputArg, nullable?: boolean): Quantity;
    constructor(value: JsonRpcInputArg, nullable?: boolean);
    toString(): string | null;
    toBuffer(): Buffer;
    toBigInt(): bigint | null;
    toNumber(): number;
    valueOf(): bigint;
    private findFirstNonZeroByteIndex;
    static toBuffer(value: JsonRpcInputArg, nullable?: boolean): Buffer;
    static toString(value: JsonRpcInputArg, nullable?: boolean): string;
    static toNumber(value: JsonRpcInputArg, nullable?: boolean): number;
    static toBigInt(value: JsonRpcInputArg, nullable?: boolean): bigint;
}
export default Quantity;
//# sourceMappingURL=json-rpc-quantity.d.ts.map