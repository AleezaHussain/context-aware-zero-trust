/// <reference types="node" />
import Manager from "./manager";
import Blockchain from "../blockchain";
import { InternalTransactionReceipt } from "@ganache/ethereum-transaction";
import { GanacheLevelUp } from "../database";
export default class TransactionReceiptManager extends Manager<InternalTransactionReceipt> {
    #private;
    constructor(base: GanacheLevelUp, blockchain: Blockchain);
    get(key: string | Buffer): Promise<InternalTransactionReceipt>;
}
//# sourceMappingURL=transaction-receipt-manager.d.ts.map