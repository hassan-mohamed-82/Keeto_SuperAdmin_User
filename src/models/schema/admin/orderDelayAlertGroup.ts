import {
    mysqlTable,
    varchar,
    char,
    timestamp,
    int,
    boolean,
    json
} from "drizzle-orm/mysql-core";
import { sql, relations } from "drizzle-orm";
import { restaurants } from "./restaurants";

export const orderDelayAlertGroups = mysqlTable("order_delay_alert_groups", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    
    // يسمح بـ null للجروبات العامة الخاصة بالسوبر أدمن
    restaurantId: char("restaurant_id", { length: 36 })
        .references(() => restaurants.id, { onDelete: "cascade" }),

    // تمييز جروبات السوبر أدمن العامة
    isSuperAdmin: boolean("is_super_admin").default(false).notNull(),
    // 1. اسم الجروب
    name: varchar("name", { length: 255 }).notNull(),
    // 2. إيميل واحد أو أكثر في نفس الحقل
    emails: json("emails").$type<string[]>().notNull(),
    // 3. كل الفروع ولا فروع معينة (لمجموعات المطعم)
    allBranches: boolean("all_branches").default(true).notNull(),
    branchIds: json("branch_ids").$type<string[]>().default([]).notNull(),

    // 4. كل المطاعم ولا مطاعم معينة (لمجموعات السوبر أدمن)
    allRestaurants: boolean("all_restaurants").default(true).notNull(),
    restaurantIds: json("restaurant_ids").$type<string[]>().default([]).notNull(),

    // 5. أقصى وقت تأخير بالدقائق
    maxDelayMinutes: int("max_delay_minutes").notNull(),
    orderStatus: json("order_status").$type<string[]>().default(['pending']).notNull(),

    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

export const orderDelayAlertGroupsRelations = relations(orderDelayAlertGroups, ({ one }) => ({
    restaurant: one(restaurants, {
        fields: [orderDelayAlertGroups.restaurantId],
        references: [restaurants.id],
    }),
}));

export type OrderDelayAlertGroup = typeof orderDelayAlertGroups.$inferSelect;
export type NewOrderDelayAlertGroup = typeof orderDelayAlertGroups.$inferInsert;

