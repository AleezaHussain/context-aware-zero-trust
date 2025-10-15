/// <reference types="node" />
import { JsonRpcInputArg } from "./input-parsers";
declare const inspect: unique symbol;
export declare class BaseJsonRpcType {
    protected bufferValue: Buffer | null;
    private [inspect];
    constructor(value: JsonRpcInputArg);
    toString(): string | null;
    toBuffer(): Buffer;
    valueOf(): any;
    toJSON(): string | null;
    isNull(): boolean;
}
export {};
//# sourceMappingURL=json-rpc-base-types.d.ts.map