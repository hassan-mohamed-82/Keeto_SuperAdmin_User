"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userWalletTransactions = exports.userWallets = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const Users_1 = require("./Users");
const schema_1 = require("../../schema");
// ==========================================
// 1. محفظة العميل (User Wallet)
// ==========================================
exports.userWallets = (0, mysql_core_1.mysqlTable)("user_wallets", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    userId: (0, mysql_core_1.char)("user_id", { length: 36 })
        .references(() => Users_1.users.id)
        .notNull()
        .unique(),
    balance: (0, mysql_core_1.decimal)("balance", { precision: 10, scale: 2 }).default("0.00"),
    loyaltyPoints: (0, mysql_core_1.int)("loyalty_points").default(0),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
// ==========================================
// 2. سجل حركات المحفظة (Wallet Transactions)
// ==========================================
exports.userWalletTransactions = (0, mysql_core_1.mysqlTable)("user_wallet_transactions", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    userId: (0, mysql_core_1.char)("user_id", { length: 36 })
        .references(() => Users_1.users.id)
        .notNull(),
    paymentMethodId: (0, mysql_core_1.char)("payment_method_id", { length: 36 })
        .references(() => schema_1.paymentMethods.id),
    type: (0, mysql_core_1.mysqlEnum)("type", ["credit", "debit"]).notNull(),
    transactionType: (0, mysql_core_1.mysqlEnum)("transaction_type", [
        "order_payment",
        "add_fund",
        "cashback",
        "converted_loyalty",
        "manual_deposit"
    ]).notNull(),
    amount: (0, mysql_core_1.decimal)("amount", { precision: 10, scale: 2 }).notNull(),
    balanceBefore: (0, mysql_core_1.decimal)("balance_before", { precision: 10, scale: 2 }).notNull(),
    reference: (0, mysql_core_1.varchar)("reference", { length: 255 }),
    receiptImage: (0, mysql_core_1.varchar)("receipt_image", { length: 500 }), // 🔥 مهم للـ manual
    status: (0, mysql_core_1.mysqlEnum)("status", ["pending", "approved", "rejected"])
        .default("approved"), // automatic = approved
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
});
