import { AppError } from "./appError";
import { StatusCodes } from "http-status-codes";

/**
 * 409 error with a machine-readable `code` that the error handler serialises as
 * a flat body: `{ success: false, code, message, ...extra }`.
 * Used by the weight-request flow (e.g. WEIGHT_REQUEST_ACTIVE, WEIGHT_CART_CHANGED).
 */
export class CodedConflictError extends AppError {
  code: string;
  extra: Record<string, unknown>;

  constructor(code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message, StatusCodes.CONFLICT, extra);
    this.code = code;
    this.extra = extra;
  }
}
