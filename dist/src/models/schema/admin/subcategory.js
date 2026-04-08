"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subcategories = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const Category_1 = require("./Category");
exports.subcategories = (0, mysql_core_1.mysqlTable)("subcategories", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    categoryId: (0, mysql_core_1.char)("category_id", { length: 36 }).references(() => Category_1.categories.id).notNull(), priority: (0, mysql_core_1.mysqlEnum)("priority", ["low", "medium", "high"]).default("low"),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
