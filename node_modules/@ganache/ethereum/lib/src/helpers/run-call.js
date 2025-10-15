"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applySimulationOverrides = exports.runCall = void 0;
const utils_1 = require("@ganache/utils");
const ethereum_address_1 = require("@ganache/ethereum-address");
const util_1 = require("@ethereumjs/util");
/**
 * Executes a message/transaction against the vm.
 * @param vm -
 * @param transaction -
 * @param gasLeft -
 * @returns
 */
function runCall(vm, transaction, gasLeft) {
    const caller = transaction.from;
    const to = transaction.to ?? null;
    const value = transaction.value == null ? 0n : transaction.value.toBigInt();
    vm.evm.runCall({
        origin: caller,
        block: transaction.block,
        gasPrice: transaction.gasPrice.toBigInt(),
        caller,
        gasLimit: gasLeft,
        to,
        value,
        data: transaction.data && transaction.data.toBuffer()
    });
}
exports.runCall = runCall;
const validateStorageOverride = (slot, value, fieldName) => {
    // assume Quantity will handle other types, these are just special string cases
    if (typeof slot === "string" && slot !== "" && slot.indexOf("0x") === 0) {
        // assume we're starting with 0x cause Quantity will verify if not
        if (slot.length != 66) {
            throw new Error(`${fieldName} override slot must be a 64 character hex string. Received ${slot.length - 2} character string.`);
        }
    }
    if (value === null || value === undefined) {
        throw new Error(`${fieldName} override data not valid. Received: ${value}`);
    }
    // assume Quantity will handle other types, these are just special string cases
    if (typeof value === "string" && value !== "" && value.indexOf("0x") === 0) {
        if (value.length != 66) {
            throw new Error(`${fieldName} override data must be a 64 character hex string. Received ${value.length - 2} character string.`);
        }
    }
};
async function applySimulationOverrides(stateTrie, vm, overrides) {
    const eei = vm.eei;
    for (const address in overrides) {
        if (!(0, utils_1.hasOwn)(overrides, address))
            continue;
        const { balance, nonce, code, state, stateDiff } = overrides[address];
        const vmAddr = ethereum_address_1.Address.from(address);
        // group together overrides that update the account
        if (nonce != null || balance != null || code != null) {
            const account = await eei.getAccount(vmAddr);
            if (nonce != null) {
                account.nonce = nonce === "" ? 0n : utils_1.Quantity.toBigInt(nonce);
            }
            if (balance != null) {
                account.balance = balance === "" ? 0n : utils_1.Quantity.toBigInt(balance);
            }
            if (code != null) {
                // geth treats empty strings as "0x" code for overrides
                const codeBuffer = utils_1.Data.toBuffer(code === "" ? "0x" : code);
                // The ethereumjs-vm StateManager does not allow to set empty code,
                // therefore we will manually set the code hash when "clearing" the contract code
                const codeHash = codeBuffer.length > 0 ? (0, utils_1.keccak)(codeBuffer) : util_1.KECCAK256_NULL;
                account.codeHash = codeHash;
                await stateTrie.database().put(codeHash, codeBuffer);
            }
            await eei.putAccount(vmAddr, account);
        }
        // group together overrides that update storage
        if (state || stateDiff) {
            if (state) {
                // state and stateDiff fields are mutually exclusive
                if (stateDiff) {
                    throw new Error("both state and stateDiff overrides specified");
                }
                // it's possible that the user fed an override with a valid address
                // and slot, but not a value we can actually set in the storage. if
                // so, we don't want to set the storage, and we also don't want to
                // clear it out
                let clearedState = false;
                for (const slot in state) {
                    if (!(0, utils_1.hasOwn)(state, slot))
                        continue;
                    const value = state[slot];
                    validateStorageOverride(slot, value, "State");
                    if (!clearedState) {
                        // override.state clears all storage and sets just the specified slots
                        await eei.clearContractStorage(vmAddr);
                        clearedState = true;
                    }
                    const slotBuf = utils_1.Data.toBuffer(slot, 32);
                    const valueBuf = utils_1.Data.toBuffer(value);
                    await eei.putContractStorage(vmAddr, slotBuf, valueBuf);
                }
            }
            else {
                for (const slot in stateDiff) {
                    // don't set storage for invalid values
                    if (!(0, utils_1.hasOwn)(stateDiff, slot))
                        continue;
                    const value = stateDiff[slot];
                    validateStorageOverride(slot, value, "StateDiff");
                    const slotBuf = utils_1.Data.toBuffer(slot, 32);
                    const valueBuf = utils_1.Data.toBuffer(value);
                    await eei.putContractStorage(vmAddr, slotBuf, valueBuf);
                }
            }
        }
    }
}
exports.applySimulationOverrides = applySimulationOverrides;
//# sourceMappingURL=run-call.js.map