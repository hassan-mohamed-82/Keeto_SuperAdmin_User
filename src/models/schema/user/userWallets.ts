import { mysqlTable, varchar, timestamp, decimal, mysqlEnum, char, int , longtext } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { users } from "./Users";
import { paymentMethods } from "../../schema";

// ==========================================
// 1. محفظة العميل (User Wallet)
// ==========================================
export const userWallets = mysqlTable("user_wallets", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    userId: char("user_id", { length: 36 })
        .references(() => users.id)
        .notNull()
        .unique(),

    balance: decimal("balance", { precision: 10, scale: 2 }).default("0.00"),

    loyaltyPoints: int("loyalty_points").default(0),

    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

// ==========================================
// 2. سجل حركات المحفظة (Wallet Transactions)
// ==========================================
export const userWalletTransactions = mysqlTable("user_wallet_transactions", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    userId: char("user_id", { length: 36 })
        .references(() => users.id)
        .notNull(),

    paymentMethodId: char("payment_method_id", { length: 36 })
        .references(() => paymentMethods.id),

    type: mysqlEnum("type", ["credit", "debit"]).notNull(),

    transactionType: mysqlEnum("transaction_type", [
        "order_payment",
        "add_fund",
        "cashback",
        "converted_loyalty",
        "manual_deposit"
    ]).notNull(),

    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),

    balanceBefore: decimal("balance_before", { precision: 10, scale: 2 }).notNull(),

    reference: varchar("reference", { length: 255 }),

    receiptImage: varchar("receipt_image", { length: 500 }), // 🔥 مهم للـ manual

    status: mysqlEnum("status", ["pending", "approved", "rejected"])
        .default("approved"), // automatic = approved

    createdAt: timestamp("created_at").defaultNow(),
});