"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.images = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const restaurants_1 = require("./restaurants");
const branches_1 = require("./branches");
const subcategory_1 = require("./subcategory");
const food_1 = require("./food");
const discount_1 = require("./discount");
const drizzle_orm_1 = require("drizzle-orm");
exports.images = (0, mysql_core_1.mysqlTable)("images", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantid: (0, mysql_core_1.char)("restaurantid", { length: 36 })
        .references(() => restaurants_1.restaurants.id)
        .notNull(),
    branchId: (0, mysql_core_1.char)("branch_id", { length: 36 }).references(() => branches_1.branches.id, { onDelete: "set null" }),
    img: (0, mysql_core_1.varchar)("img", { length: 500 }).notNull(),
    periorty: (0, mysql_core_1.int)("periorty").default(0),
    linkType: (0, mysql_core_1.mysqlEnum)("link_type", ["link", "subcategory", "product", "discount"]).default("link"),
    link: (0, mysql_core_1.varchar)("link", { length: 500 }),
    subcategoryId: (0, mysql_core_1.char)("subcategory_id", { length: 36 }).references(() => subcategory_1.subcategories.id, { onDelete: "set null" }),
    foodId: (0, mysql_core_1.char)("food_id", { length: 36 }).references(() => food_1.food.id, { onDelete: "set null" }),
    discountId: (0, mysql_core_1.char)("discount_id", { length: 36 }).references(() => discount_1.discounts.id, { onDelete: "set null" }),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
