// models/restaurantWallet.ts
import { mysqlTable, varchar, char, timestamp, decimal, text, mysqlEnum } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "./restaurants";

// ==========================================
// Restaurant Wallet
// ==========================================
export const restaurantWallets = mysqlTable("restaurant_wallets", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    restaurantId: char("restaurant_id", { length: 36 })
        .references(() => restaurants.id)
        .notNull()
        .unique(),

    balance: decimal("balance", { precision: 10, scale: 2 }).default("0.00"),
    collectedCash: decimal("collected_cash", { precision: 10, scale: 2 }).default("0.00"),
    pendingWithdraw: decimal("pending_withdraw", { precision: 10, scale: 2 }).default("0.00"),
    totalWithdrawn: decimal("total_withdrawn", { precision: 10, scale: 2 }).default("0.00"),
    totalEarning: decimal("total_earning", { precision: 10, scale: 2 }).default("0.00"),

    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

// ==========================================
// Wallet Transactions (IMPORTANT)
// ==========================================
export const restaurantWalletTransactions = mysqlTable("restaurant_wallet_transactions", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    restaurantId: char("restaurant_id", { length: 36 })
        .references(() => restaurants.id)
        .notNull(),

    type: mysqlEnum("type", [
        "order_payment",
        "cash_collection",
        "withdraw_request",
        "withdraw_approved",
        "adjustment"
    ]).notNull(),

    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),

    balanceBefore: decimal("balance_before", { precision: 10, scale: 2 }).notNull(),
    balanceAfter: decimal("balance_after", { precision: 10, scale: 2 }).notNull(),

    method: varchar("method", { length: 50 }).default("cash"),
    reference: varchar("reference", { length: 255 }),

    note: text("note"),

    createdAt: timestamp("created_at").defaultNow(),
});