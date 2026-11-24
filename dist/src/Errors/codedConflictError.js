"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodedConflictError = void 0;
const appError_1 = require("./appError");
const http_status_codes_1 = require("http-status-codes");
/**
 * 409 error with a machine-readable `code` that the error handler serialises as
 * a flat body: `{ success: false, code, message, ...extra }`.
 * Used by the weight-request flow (e.g. WEIGHT_REQUEST_ACTIVE, WEIGHT_CART_CHANGED).
 */
class CodedConflictError extends appError_1.AppError {
    constructor(code, message, extra = {}) {
        super(message, http_status_codes_1.StatusCodes.CONFLICT, extra);
        this.code = code;
        this.extra = extra;
    }
}
exports.CodedConflictError = CodedConflictError;
