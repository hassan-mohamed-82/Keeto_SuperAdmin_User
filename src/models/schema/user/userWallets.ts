// models/schema/userWallets.ts
import { mysqlTable, varchar, timestamp, decimal, mysqlEnum, char, int, index } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { users } from "./Users";
import { paymentMethods } from "../../schema";

// ==========================================
// 1. محفظة العميل (User Wallet)
// ==========================================
export const userWallets = mysqlTable("user_wallets", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    userId: char("user_id", { length: 36 })
        .references(() => users.id, { onDelete: "cascade" })
        .notNull()
        .unique(),

    balance: decimal("balance", { precision: 10, scale: 2 }).default("0.00").notNull(),

    loyaltyPoints: int("loyalty_points").default(0).notNull(),

    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

// ==========================================
// 2. سجل حركات المحفظة (Wallet Transactions)
// ==========================================
export const userWalletTransactions = mysqlTable("user_wallet_transactions", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    userId: char("user_id", { length: 36 })
        .references(() => users.id, { onDelete: "cascade" })
        .notNull(),

    paymentMethodId: char("payment_method_id", { length: 36 })
        .references(() => paymentMethods.id, { onDelete: "set null" }),

    type: mysqlEnum("type", ["credit", "debit"]).notNull(),

    transactionType: mysqlEnum("transaction_type", [
        "order_payment",
        "add_fund",
        "cashback",
        "converted_loyalty",
        "manual_deposit",
        "refund"
    ]).notNull(),

    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),

    balanceBefore: decimal("balance_before", { precision: 10, scale: 2 }).notNull(),

    reference: varchar("reference", { length: 255 }),

    receiptImage: varchar("receipt_image", { length: 500 }),

    status: mysqlEnum("status", ["pending", "approved", "rejected"])
        .default("approved").notNull(),

    createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
    userIdx: index("user_wallet_tx_user_idx").on(table.userId),
    refIdx: index("user_wallet_tx_ref_idx").on(table.reference),
}));