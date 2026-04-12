import { mysqlTable, varchar, char, timestamp, decimal, mysqlEnum, text } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "./restaurants"; 

// ==========================================
// 1. المحفظة (Restaurant Wallets)
// ==========================================
export const restaurantWallets = mysqlTable("restaurant_wallets", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    restaurantId: char("restaurant_id", { length: 36 }).references(() => restaurants.id).notNull().unique(),

    balance: decimal("balance", { precision: 10, scale: 2 }).default("0.00"), // حق المطعم (من فيزا)
    collectedCash: decimal("collected_cash", { precision: 10, scale: 2 }).default("0.00"), // حقك أنت (من كاش)
    pendingWithdraw: decimal("pending_withdraw", { precision: 10, scale: 2 }).default("0.00"), // قيد السحب
    totalWithdrawn: decimal("total_withdrawn", { precision: 10, scale: 2 }).default("0.00"), // تم سحبه فعلياً
    totalEarning: decimal("total_earning", { precision: 10, scale: 2 }).default("0.00"), // إجمالي أرباحه تاريخياً

    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

// ==========================================
// 2. سجل الحركات المالي (Transactions)
// ==========================================
export const accountTransactions = mysqlTable("account_transactions", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    restaurantId: char("restaurant_id", { length: 36 }).references(() => restaurants.id),
    
    type: varchar("type", { length: 100 }).notNull(), // مثلا: "Cash Collection", "Withdrawal Approval"
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    balanceBefore: decimal("balance_before", { precision: 10, scale: 2 }).notNull(), // الرصيد قبل الحركة (زي الصورة)
    method: varchar("method", { length: 50 }).default("Cash"),
    reference: varchar("reference", { length: 255 }), 
    
    createdAt: timestamp("created_at").defaultNow(),
});