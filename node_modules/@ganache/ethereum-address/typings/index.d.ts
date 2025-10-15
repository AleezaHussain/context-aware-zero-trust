/// <reference types="node" />
import { Address as EJSAddress } from "@ethereumjs/util";
import { JsonRpcDataInputArg } from "@ganache/utils";
export declare class Address extends EJSAddress {
    static ByteLength: number;
    constructor(value: Buffer);
    static from<T extends string | Buffer = string | Buffer>(value: T): Address;
    static toBuffer(value: JsonRpcDataInputArg): Buffer;
    static toString(value: JsonRpcDataInputArg): string;
    toJSON(): string;
}
//# sourceMappingURL=index.d.ts.map