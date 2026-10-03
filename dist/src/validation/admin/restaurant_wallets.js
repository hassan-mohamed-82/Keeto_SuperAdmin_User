"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordSubscriptionSchema = exports.updateWalletTransactionSchema = exports.createWalletTransactionSchema = exports.updateRestaurantWalletSchema = exports.createRestaurantWalletSchema = void 0;
const zod_1 = require("zod");
// ==========================================
// 1. Restaurant Wallets Validation
// ==========================================
exports.createRestaurantWalletSchema = zod_1.z.object({
    restaurantId: zod_1.z.string().uuid("Invalid Restaurant ID"),
    // كل القيم المالية ليها Default "0.00" فبنخليها Optional
    balance: zod_1.z.coerce.string().optional(),
    collectedCash: zod_1.z.coerce.string().optional(),
    pendingWithdraw: zod_1.z.coerce.string().optional(),
    totalWithdrawn: zod_1.z.coerce.string().optional(),
    totalEarning: zod_1.z.coerce.string().optional(),
});
exports.updateRestaurantWalletSchema = exports.createRestaurantWalletSchema.partial();
// ==========================================
// 2. Restaurant Wallet Transactions Validation
// ==========================================
exports.createWalletTransactionSchema = zod_1.z.object({
    restaurantId: zod_1.z.string().uuid("Invalid Restaurant ID"),
    type: zod_1.z.enum([
        "order_payment",
        "cash_collection",
        "withdraw",
        "adjustment",
        "subscription",
    ], { required_error: "Transaction type is required" }),
    amount: zod_1.z.coerce.string().min(1, "Amount is required"),
    balanceBefore: zod_1.z.coerce.string().min(1, "Balance before is required"),
    balanceAfter: zod_1.z.coerce.string().min(1, "Balance after is required"),
    method: zod_1.z.string().max(50).optional(),
    reference: zod_1.z.string().max(255).optional(),
    note: zod_1.z.string().optional(),
});
exports.updateWalletTransactionSchema = exports.createWalletTransactionSchema.partial();
// ==========================================
// 3. Record Subscription Validation
// ==========================================
exports.recordSubscriptionSchema = zod_1.z.object({
    restaurantId: zod_1.z.string().uuid("Invalid Restaurant ID"),
    subscriptionType: zod_1.z.enum(["monthly", "quarterly", "annually"], {
        required_error: "subscriptionType is required",
        invalid_type_error: "subscriptionType must be 'monthly', 'quarterly', or 'annually'",
    }),
    amount: zod_1.z.coerce.number().positive("Amount must be > 0"),
    subscriptionDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "subscriptionDate must be in YYYY-MM-DD format").optional(),
    note: zod_1.z.string().optional(),
});
