"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.categories = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
exports.categories = (0, mysql_core_1.mysqlTable)("categories", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    nameAr: (0, mysql_core_1.varchar)("name_ar", { length: 255 }).notNull().default(''),
    nameFr: (0, mysql_core_1.varchar)("name_fr", { length: 255 }).notNull().default(''),
    Image: (0, mysql_core_1.varchar)("image", { length: 500 }).notNull(),
    meta_image: (0, mysql_core_1.varchar)("meta_image", { length: 500 }),
    title: (0, mysql_core_1.text)("title"),
    titleAr: (0, mysql_core_1.text)("title_ar").notNull().default(''),
    titleFr: (0, mysql_core_1.text)("title_fr").notNull().default(''),
    meta_title: (0, mysql_core_1.text)("meta_title"),
    meta_titleAr: (0, mysql_core_1.text)("meta_title_ar").notNull().default(''),
    meta_titleFr: (0, mysql_core_1.text)("meta_title_fr").notNull().default(''),
    priority: (0, mysql_core_1.mysqlEnum)("priority", ["low", "medium", "high"]).default("low"),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
