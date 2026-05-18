"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.popup = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../../schema");
exports.popup = (0, mysql_core_1.mysqlTable)("popup", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    Title: (0, mysql_core_1.varchar)("title", { length: 255 }).notNull(),
    TitleAr: (0, mysql_core_1.varchar)("title_ar", { length: 255 }),
    TitleFr: (0, mysql_core_1.varchar)("title_fr", { length: 255 }),
    description: (0, mysql_core_1.varchar)("description", { length: 500 }),
    descriptionAr: (0, mysql_core_1.varchar)("description_ar", { length: 500 }),
    descriptionFr: (0, mysql_core_1.varchar)("description_fr", { length: 500 }),
    image: (0, mysql_core_1.varchar)("image", { length: 500 }),
    imageAr: (0, mysql_core_1.varchar)("image_ar", { length: 500 }),
    imageFr: (0, mysql_core_1.varchar)("image_fr", { length: 500 }),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 }).references(() => schema_1.restaurants.id),
    type: (0, mysql_core_1.mysqlEnum)("type", ["web", "home_web", "home_app", "mykeeto_app"]).default("mykeeto_app"),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active"),
    startDate: (0, mysql_core_1.timestamp)("start_date").notNull(),
    endDate: (0, mysql_core_1.timestamp)("end_date").notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
