import { mysqlTable, varchar, timestamp, decimal, mysqlEnum, char, int } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { users } from "../admin/Users";

// ==========================================
// 1. محفظة العميل (User Wallet)
// ==========================================
export const userWallets = mysqlTable("user_wallets", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    userId: char("user_id", { length: 36 }).references(() => users.id).notNull().unique(),
    balance: decimal("balance", { precision: 10, scale: 2 }).default("0.00"), 
    loyaltyPoints: int("loyalty_points").default(0),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

// ==========================================
// 2. سجل حركات المحفظة (Wallet Transactions)
// ==========================================
export const userWalletTransactions = mysqlTable("user_wallet_transactions", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    userId: char("user_id", { length: 36 }).references(() => users.id).notNull(),
    
    type: mysqlEnum("type", ["credit", "debit"]).notNull(), // credit = دخول فلوس، debit = خروج فلوس
    
    // 👇 ده اللي سألت عليه: طريقة الدفع أو الشحن
    paymentMethod: varchar("payment_method", { length: 50 }), // ممكن يكون فاضي لو تحويل نقاط مثلا
    
    transactionType: mysqlEnum("transaction_type", [
        "order_payment", 
        "add_fund", 
        "cashback",
        "added_via_payment",
        "converted_loyalty",
        "order_transaction"
    ]).notNull(),

    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    balanceBefore: decimal("balance_before", { precision: 10, scale: 2 }).notNull(),
    reference: varchar("reference", { length: 255 }), // رقم العملية أو الأوردر
    createdAt: timestamp("created_at").defaultNow(),
});