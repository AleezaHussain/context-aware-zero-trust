"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.min = exports.max = void 0;
/**
 * Returns the largest of the numbers/bigints given as input parameters. Throws if no values are given.
 * @param numbers One or more numbers and/or bigints among which the largest value will be selected and returned.
 */
const max = (...numbers) => numbers.reduce((acc, next) => (next > acc ? next : acc));
exports.max = max;
/**
 * Returns the smallest of the numbers/bigints given as input parameters. Throws if no values are given.
 * @param numbers One or more numbers and/or bigints among which the smallest value will be selected and returned.
 */
const min = (...numbers) => numbers.reduce((acc, next) => (next < acc ? next : acc));
exports.min = min;
//# sourceMappingURL=min-max.js.map