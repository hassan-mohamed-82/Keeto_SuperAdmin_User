"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderDelayAlertGroupsRelations = exports.orderDelayAlertGroups = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const restaurants_1 = require("./restaurants");
exports.orderDelayAlertGroups = (0, mysql_core_1.mysqlTable)("order_delay_alert_groups", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    // يسمح بـ null للجروبات العامة الخاصة بالسوبر أدمن
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .references(() => restaurants_1.restaurants.id, { onDelete: "cascade" }),
    // تمييز جروبات السوبر أدمن العامة
    isSuperAdmin: (0, mysql_core_1.boolean)("is_super_admin").default(false).notNull(),
    // 1. اسم الجروب
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    // 2. إيميل واحد أو أكثر في نفس الحقل
    emails: (0, mysql_core_1.json)("emails").$type().notNull(),
    // 3. كل الفروع ولا فروع معينة (لمجموعات المطعم)
    allBranches: (0, mysql_core_1.boolean)("all_branches").default(true).notNull(),
    branchIds: (0, mysql_core_1.json)("branch_ids").$type().default([]).notNull(),
    // 4. كل المطاعم ولا مطاعم معينة (لمجموعات السوبر أدمن)
    allRestaurants: (0, mysql_core_1.boolean)("all_restaurants").default(true).notNull(),
    restaurantIds: (0, mysql_core_1.json)("restaurant_ids").$type().default([]).notNull(),
    // 5. أقصى وقت تأخير بالدقائق
    maxDelayMinutes: (0, mysql_core_1.int)("max_delay_minutes").notNull(),
    orderStatus: (0, mysql_core_1.json)("order_status").$type().default(['pending']).notNull(),
    isActive: (0, mysql_core_1.boolean)("is_active").default(true).notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
exports.orderDelayAlertGroupsRelations = (0, drizzle_orm_1.relations)(exports.orderDelayAlertGroups, ({ one }) => ({
    restaurant: one(restaurants_1.restaurants, {
        fields: [exports.orderDelayAlertGroups.restaurantId],
        references: [restaurants_1.restaurants.id],
    }),
}));
