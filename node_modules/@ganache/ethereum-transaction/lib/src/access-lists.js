"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccessLists = exports.isAccessList = void 0;
const tx_1 = require("@ethereumjs/tx");
var tx_2 = require("@ethereumjs/tx");
Object.defineProperty(exports, "isAccessList", { enumerable: true, get: function () { return tx_2.isAccessList; } });
const utils_1 = require("@ganache/utils");
const ethereum_address_1 = require("@ganache/ethereum-address");
const params_1 = require("./params");
const STORAGE_KEY_LENGTH = 32;
/*
  As per https://github.com/ethereum/EIPs/blob/master/EIPS/eip-2930.md

  AccessLists must be in the form of:
  [[{20 bytes}, [{32 bytes}...]]...]
  where ... implies "zero or more of the thing to the left"
*/
class AccessLists {
    static getAccessListData(accessList) {
        let AccessListJSON;
        let bufferAccessList;
        let slots = 0;
        const accessListStorageKeyCost = params_1.Params.ACCESS_LIST_STORAGE_KEY_GAS;
        const accessListAddressCost = params_1.Params.ACCESS_LIST_ADDRESS_GAS;
        if (accessList && (0, tx_1.isAccessList)(accessList)) {
            AccessListJSON = accessList;
            const newAccessList = [];
            for (let i = 0; i < accessList.length; i++) {
                const item = accessList[i];
                const addressBuffer = ethereum_address_1.Address.toBuffer(item.address);
                const storageItems = [];
                const storageKeysLength = item.storageKeys.length;
                slots += storageKeysLength;
                for (let index = 0; index < storageKeysLength; index++) {
                    storageItems.push(utils_1.Data.toBuffer(item.storageKeys[index], STORAGE_KEY_LENGTH));
                }
                newAccessList.push([addressBuffer, storageItems]);
            }
            bufferAccessList = newAccessList;
        }
        else {
            bufferAccessList = accessList ? accessList : [];
            // build the JSON
            const json = [];
            for (let i = 0; i < bufferAccessList.length; i++) {
                const data = bufferAccessList[i];
                const address = ethereum_address_1.Address.toString(data[0]);
                const storageKeys = [];
                const storageKeysLength = data[1].length;
                slots += storageKeysLength;
                for (let item = 0; item < storageKeysLength; item++) {
                    storageKeys.push(utils_1.Data.toString(data[1][item], STORAGE_KEY_LENGTH));
                }
                const jsonItem = {
                    address,
                    storageKeys
                };
                json.push(jsonItem);
            }
            AccessListJSON = json;
        }
        const dataFee = BigInt(bufferAccessList.length * accessListAddressCost +
            slots * accessListStorageKeyCost);
        return {
            AccessListJSON,
            accessList: bufferAccessList,
            dataFeeEIP2930: dataFee
        };
    }
}
exports.AccessLists = AccessLists;
//# sourceMappingURL=access-lists.js.map