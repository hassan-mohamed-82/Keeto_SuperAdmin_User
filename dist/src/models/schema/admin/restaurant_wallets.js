"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restaurantWalletTransactions = exports.restaurantWallets = void 0;
// models/restaurantWallet.ts
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const restaurants_1 = require("./restaurants");
// ==========================================
// Restaurant Wallet
// ==========================================
exports.restaurantWallets = (0, mysql_core_1.mysqlTable)("restaurant_wallets", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .references(() => restaurants_1.restaurants.id)
        .notNull()
        .unique(),
    balance: (0, mysql_core_1.decimal)("balance", { precision: 10, scale: 2 }).default("0.00"),
    collectedCash: (0, mysql_core_1.decimal)("collected_cash", { precision: 10, scale: 2 }).default("0.00"),
    pendingWithdraw: (0, mysql_core_1.decimal)("pending_withdraw", { precision: 10, scale: 2 }).default("0.00"),
    totalWithdrawn: (0, mysql_core_1.decimal)("total_withdrawn", { precision: 10, scale: 2 }).default("0.00"),
    totalEarning: (0, mysql_core_1.decimal)("total_earning", { precision: 10, scale: 2 }).default("0.00"),
    // ==========================================
    // تتبع الـ Service Fees والكوميشن والاشتراكات
    // ==========================================
    // إجمالي service fees المتراكمة (الرسوم الثابتة لكل أوردر)
    totalServiceFees: (0, mysql_core_1.decimal)("total_service_fees", { precision: 10, scale: 2 }).default("0.00"),
    // إجمالي الكوميشن المتراكم (نسبة من قيمة الأوردر)
    totalCommission: (0, mysql_core_1.decimal)("total_commission", { precision: 10, scale: 2 }).default("0.00"),
    // إجمالي عمولة الفيزا المتراكمة (بوابات الدفع المخصصة)
    totalVisaCommission: (0, mysql_core_1.decimal)("total_visa_commission", { precision: 10, scale: 2 }).default("0.00"),
    // إجمالي الاشتراكات المسجلة (شهري + ربع سنوي + سنوي)
    totalSubscriptions: (0, mysql_core_1.decimal)("total_subscriptions", { precision: 10, scale: 2 }).default("0.00"),
    // آخر اشتراك شهري مسجل
    lastMonthlySubscription: (0, mysql_core_1.decimal)("last_monthly_subscription", { precision: 10, scale: 2 }).default("0.00"),
    // آخر اشتراك ربع سنوي مسجل
    lastQuarterlySubscription: (0, mysql_core_1.decimal)("last_quarterly_subscription", { precision: 10, scale: 2 }).default("0.00"),
    // آخر اشتراك سنوي مسجل
    lastAnnuallySubscription: (0, mysql_core_1.decimal)("last_annually_subscription", { precision: 10, scale: 2 }).default("0.00"),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
// ==========================================
// Wallet Transactions (IMPORTANT)
// ==========================================
exports.restaurantWalletTransactions = (0, mysql_core_1.mysqlTable)("restaurant_wallet_transactions", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .references(() => restaurants_1.restaurants.id)
        .notNull(),
    orderId: (0, mysql_core_1.char)("order_id", { length: 36 }),
    type: (0, mysql_core_1.mysqlEnum)("type", [
        "order_payment",
        "cash_collection",
        "withdraw",
        "adjustment",
        "subscription",
    ]).notNull(),
    amount: (0, mysql_core_1.decimal)("amount", { precision: 10, scale: 2 }).notNull(),
    balanceBefore: (0, mysql_core_1.decimal)("balance_before", { precision: 10, scale: 2 }).notNull(),
    balanceAfter: (0, mysql_core_1.decimal)("balance_after", { precision: 10, scale: 2 }).notNull(),
    method: (0, mysql_core_1.varchar)("method", { length: 50 }).default("cash"),
    reference: (0, mysql_core_1.varchar)("reference", { length: 255 }),
    // تفاصيل الرسوم والعمولة الخاصة بهذا الأوردر بالتحديد
    serviceFee: (0, mysql_core_1.decimal)("service_fee", { precision: 10, scale: 2 }).default("0.00"),
    commission: (0, mysql_core_1.decimal)("commission", { precision: 10, scale: 2 }).default("0.00"),
    visaCommission: (0, mysql_core_1.decimal)("visa_commission", { precision: 10, scale: 2 }).default("0.00"),
    orderAmount: (0, mysql_core_1.decimal)("order_amount", { precision: 10, scale: 2 }).default("0.00"),
    note: (0, mysql_core_1.text)("note"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
});
