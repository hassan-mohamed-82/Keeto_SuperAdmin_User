// models/restaurantWallet.ts
import { mysqlTable, varchar, char, timestamp, decimal, text, mysqlEnum, date as mysqlDate } from "drizzle-orm/mysql-core";
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

    // ==========================================
    // تتبع الـ Service Fees والكوميشن والاشتراكات
    // ==========================================
    // إجمالي service fees المتراكمة (الرسوم الثابتة لكل أوردر)
    totalServiceFees: decimal("total_service_fees", { precision: 10, scale: 2 }).default("0.00"),
    // إجمالي الكوميشن المتراكم (نسبة من قيمة الأوردر)
    totalCommission: decimal("total_commission", { precision: 10, scale: 2 }).default("0.00"),
    // إجمالي عمولة الفيزا المتراكمة (بوابات الدفع المخصصة)
    totalVisaCommission: decimal("total_visa_commission", { precision: 10, scale: 2 }).default("0.00"),
    // إجمالي الاشتراكات المسجلة (شهري + ربع سنوي + سنوي)
    totalSubscriptions: decimal("total_subscriptions", { precision: 10, scale: 2 }).default("0.00"),
    // آخر اشتراك شهري مسجل
    lastMonthlySubscription: decimal("last_monthly_subscription", { precision: 10, scale: 2 }).default("0.00"),
    // آخر اشتراك ربع سنوي مسجل
    lastQuarterlySubscription: decimal("last_quarterly_subscription", { precision: 10, scale: 2 }).default("0.00"),
    // آخر اشتراك سنوي مسجل
    lastAnnuallySubscription: decimal("last_annually_subscription", { precision: 10, scale: 2 }).default("0.00"),

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

    orderId: char("order_id", { length: 36 }),

    type: mysqlEnum("type", [
        "order_payment",
        "cash_collection",
        "withdraw",
        "adjustment",
        "subscription",
    ]).notNull(),

    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),

    balanceBefore: decimal("balance_before", { precision: 10, scale: 2 }).notNull(),
    balanceAfter: decimal("balance_after", { precision: 10, scale: 2 }).notNull(),

    method: varchar("method", { length: 50 }).default("cash"),
    reference: varchar("reference", { length: 255 }),

    // تفاصيل الرسوم والعمولة الخاصة بهذا الأوردر بالتحديد
    serviceFee: decimal("service_fee", { precision: 10, scale: 2 }).default("0.00"),
    commission: decimal("commission", { precision: 10, scale: 2 }).default("0.00"),
    visaCommission: decimal("visa_commission", { precision: 10, scale: 2 }).default("0.00"),
    orderAmount: decimal("order_amount", { precision: 10, scale: 2 }).default("0.00"),

    note: text("note"),

    createdAt: timestamp("created_at").defaultNow(),
});