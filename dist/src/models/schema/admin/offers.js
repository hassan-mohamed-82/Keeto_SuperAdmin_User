"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.offerFoodsRelations = exports.offersRelations = exports.offerFoods = exports.offers = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const restaurants_1 = require("./restaurants");
const food_1 = require("./food");
exports.offers = (0, mysql_core_1.mysqlTable)("offers", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 }).references(() => restaurants_1.restaurants.id, { onDelete: "cascade" }),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    image: (0, mysql_core_1.varchar)("image", { length: 500 }),
    startDate: (0, mysql_core_1.timestamp)("start_date").notNull(),
    endDate: (0, mysql_core_1.timestamp)("end_date").notNull(),
    price: (0, mysql_core_1.decimal)("price", { precision: 10, scale: 2 }).notNull(),
    foodIds: (0, mysql_core_1.json)("food_ids").$type().default([]).notNull(),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active").notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
exports.offerFoods = (0, mysql_core_1.mysqlTable)("offer_foods", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    offerId: (0, mysql_core_1.char)("offer_id", { length: 36 })
        .references(() => exports.offers.id, { onDelete: "cascade" })
        .notNull(),
    foodId: (0, mysql_core_1.char)("food_id", { length: 36 })
        .references(() => food_1.food.id, { onDelete: "cascade" })
        .notNull(),
    variations: (0, mysql_core_1.json)("variations").$type().default([]).notNull(),
    optionIds: (0, mysql_core_1.json)("option_ids").$type().default([]).notNull(),
    quantity: (0, mysql_core_1.int)("quantity").default(1).notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
exports.offersRelations = (0, drizzle_orm_1.relations)(exports.offers, ({ many }) => ({
    offerFoods: many(exports.offerFoods),
}));
exports.offerFoodsRelations = (0, drizzle_orm_1.relations)(exports.offerFoods, ({ one }) => ({
    offer: one(exports.offers, {
        fields: [exports.offerFoods.offerId],
        references: [exports.offers.id],
    }),
    food: one(food_1.food, {
        fields: [exports.offerFoods.foodId],
        references: [food_1.food.id],
    }),
}));
