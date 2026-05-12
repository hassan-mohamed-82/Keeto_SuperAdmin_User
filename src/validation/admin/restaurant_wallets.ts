import { z } from "zod";

// ==========================================
// 1. Restaurant Wallets Validation
// ==========================================
export const createRestaurantWalletSchema = z.object({
    restaurantId: z.string().uuid("Invalid Restaurant ID"),
    // كل القيم المالية ليها Default "0.00" فبنخليها Optional
    balance: z.coerce.string().optional(),
    collectedCash: z.coerce.string().optional(),
    pendingWithdraw: z.coerce.string().optional(),
    totalWithdrawn: z.coerce.string().optional(),
    totalEarning: z.coerce.string().optional(),
});

export const updateRestaurantWalletSchema = createRestaurantWalletSchema.partial();

// ==========================================
// 2. Restaurant Wallet Transactions Validation
// ==========================================
export const createWalletTransactionSchema = z.object({
    restaurantId: z.string().uuid("Invalid Restaurant ID"),
    type: z.enum([
        "order_payment",
        "cash_collection",
        "withdraw_request",
        "withdraw_approved",
        "adjustment"
    ], { required_error: "Transaction type is required" }),
    
    amount: z.coerce.string().min(1, "Amount is required"),
    balanceBefore: z.coerce.string().min(1, "Balance before is required"),
    balanceAfter: z.coerce.string().min(1, "Balance after is required"),
    
    method: z.string().max(50).optional(),
    reference: z.string().max(255).optional(),
    note: z.string().optional(),
});

export const updateWalletTransactionSchema = createWalletTransactionSchema.partial();