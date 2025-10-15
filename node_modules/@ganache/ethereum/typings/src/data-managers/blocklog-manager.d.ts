/// <reference types="node" />
import { BlockLogs, FilterArgs } from "@ganache/ethereum-utils";
import Manager from "./manager";
import Blockchain from "../blockchain";
import { Ethereum } from "../api-types";
import { GanacheLevelUp } from "../database";
export default class BlockLogManager extends Manager<BlockLogs> {
    #private;
    constructor(base: GanacheLevelUp, blockchain: Blockchain);
    get(key: string | Buffer): Promise<BlockLogs>;
    getLogs(filter: FilterArgs): Promise<Ethereum.Logs>;
}
//# sourceMappingURL=blocklog-manager.d.ts.map