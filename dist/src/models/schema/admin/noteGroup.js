"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.noteItemsRelations = exports.noteGroupsRelations = exports.noteItem = exports.noteItems = exports.noteGroup = exports.noteGroups = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const food_1 = require("./food");
const restaurants_1 = require("./restaurants");
exports.noteGroups = (0, mysql_core_1.mysqlTable)("note_groups", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 }).references(() => restaurants_1.restaurants.id, { onDelete: "cascade" }),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    nameAr: (0, mysql_core_1.varchar)("name_ar", { length: 255 }),
    nameFr: (0, mysql_core_1.varchar)("name_fr", { length: 255 }),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
exports.noteGroup = exports.noteGroups;
exports.noteItems = (0, mysql_core_1.mysqlTable)("note_items", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 }).references(() => restaurants_1.restaurants.id, { onDelete: "cascade" }),
    group_note_id: (0, mysql_core_1.char)("group_note_id", { length: 36 })
        .references(() => exports.noteGroups.id, { onDelete: "cascade" })
        .notNull(),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    nameAr: (0, mysql_core_1.varchar)("name_ar", { length: 255 }),
    nameFr: (0, mysql_core_1.varchar)("name_fr", { length: 255 }),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
exports.noteItem = exports.noteItems;
exports.noteGroupsRelations = (0, drizzle_orm_1.relations)(exports.noteGroups, ({ one, many }) => ({
    restaurant: one(restaurants_1.restaurants, {
        fields: [exports.noteGroups.restaurantId],
        references: [restaurants_1.restaurants.id],
    }),
    items: many(exports.noteItems),
    foods: many(food_1.food),
}));
exports.noteItemsRelations = (0, drizzle_orm_1.relations)(exports.noteItems, ({ one }) => ({
    restaurant: one(restaurants_1.restaurants, {
        fields: [exports.noteItems.restaurantId],
        references: [restaurants_1.restaurants.id],
    }),
    group: one(exports.noteGroups, {
        fields: [exports.noteItems.group_note_id],
        references: [exports.noteGroups.id],
    }),
}));
