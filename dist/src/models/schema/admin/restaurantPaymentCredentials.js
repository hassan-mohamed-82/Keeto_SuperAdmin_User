"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restaurantPaymentCredentials = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const restaurants_1 = require("./restaurants");
// ==========================================
// 2. تعريف الجدول باستخدام الـ Type المعرّف
// ==========================================
exports.restaurantPaymentCredentials = (0, mysql_core_1.mysqlTable)("restaurant_payment_credentials", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .notNull()
        .references(() => restaurants_1.restaurants.id, { onDelete: "cascade" }),
    provider: (0, mysql_core_1.mysqlEnum)("provider", ["PAYMOB", "KASHIER"]).notNull(),
    title: (0, mysql_core_1.varchar)("title", { length: 255 }).notNull(),
    environment: (0, mysql_core_1.mysqlEnum)("environment", ["LIVE", "TEST"]).default("LIVE"),
    // 💡 استخدام Type المخصص هنا لدعم Paymob و Kashier
    credentials: (0, mysql_core_1.json)("credentials").$type().notNull(),
    logoUrl: (0, mysql_core_1.varchar)("logo_url", { length: 500 }),
    isActive: (0, mysql_core_1.boolean)("is_active").default(true),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
