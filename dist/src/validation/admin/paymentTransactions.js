"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPaymentTransactionsQuerySchema = void 0;
const zod_1 = require("zod");
exports.getPaymentTransactionsQuerySchema = zod_1.z.object({
    orderId: zod_1.z.string().optional(),
    orderNumber: zod_1.z.string().optional(),
    restaurantId: zod_1.z.string().optional(),
    gateway: zod_1.z.enum(["paymob", "kashier", "geidea"]).optional(),
    status: zod_1.z.enum(["pending", "success", "failed"]).optional(),
    page: zod_1.z.string().optional(),
    limit: zod_1.z.string().optional(),
});
