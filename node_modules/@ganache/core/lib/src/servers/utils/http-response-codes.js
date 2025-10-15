"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * HTTP/1.1 Response Status-Codes, including the _required_ space character.
 *
 * e.g., `"200 "` or `"404 "`
 *
 * RFC Grammar:
 *
 * ```ebnf
 * Status-Line = HTTP-Version SP Status-Code SP Reason-Phrase CRLF
 * ```
 *
 * The Status-Codes defined here fullfill the `Status-Code SP` part of the above
 * grammar.
 *
 * See https://datatracker.ietf.org/doc/html/rfc2616#section-6.1 for details.
 */
var HttpResponseCodes;
(function (HttpResponseCodes) {
    HttpResponseCodes["OK"] = "200 ";
    HttpResponseCodes["NO_CONTENT"] = "204 ";
    HttpResponseCodes["BAD_REQUEST"] = "400 ";
    HttpResponseCodes["NOT_FOUND"] = "404 ";
    HttpResponseCodes["METHOD_NOT_ALLOWED"] = "405 ";
    HttpResponseCodes["IM_A_TEAPOT"] = "418 ";
})(HttpResponseCodes || (HttpResponseCodes = {}));
exports.default = HttpResponseCodes;
//# sourceMappingURL=http-response-codes.js.map