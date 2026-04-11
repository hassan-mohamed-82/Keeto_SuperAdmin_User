import { mysqlTable, varchar, char, timestamp, decimal, mysqlEnum } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "./restaurants"; // ⚠️ تأكد من المسار

export const restaurantWallets = mysqlTable("restaurant_wallets", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    restaurantId: char("restaurant_id", { length: 36 }).references(() => restaurants.id).notNull().unique(),

    balance: decimal("balance", { precision: 10, scale: 2 }).default("0.00"), // رصيد المطعم (من طلبات الفيزا)
    collectedCash: decimal("collected_cash", { precision: 10, scale: 2 }).default("0.00"), // الكاش اللي مع المطعم (عمولتك اللي عنده)
    pendingWithdraw: decimal("pending_withdraw", { precision: 10, scale: 2 }).default("0.00"), // طلبات سحب قيد المراجعة
    totalWithdrawn: decimal("total_withdrawn", { precision: 10, scale: 2 }).default("0.00"), // إجمالي المسحوبات
    totalEarning: decimal("total_earning", { precision: 10, scale: 2 }).default("0.00"), // إجمالي أرباح المطعم

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});