"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.videos = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
exports.videos = (0, mysql_core_1.mysqlTable)("videos", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    title: (0, mysql_core_1.varchar)("title", { length: 255 }).notNull(),
    titleAr: (0, mysql_core_1.varchar)("title_ar", { length: 255 }).notNull(),
    description: (0, mysql_core_1.text)("description"),
    descriptionAr: (0, mysql_core_1.text)("description_ar"),
    videoUrl: (0, mysql_core_1.varchar)("video_url", { length: 1000 }).notNull(),
    videoUrlAr: (0, mysql_core_1.varchar)("video_url_ar", { length: 1000 }),
    thumbnailUrl: (0, mysql_core_1.varchar)("thumbnail_url", { length: 1000 }),
    thumbnailUrlAr: (0, mysql_core_1.varchar)("thumbnail_url_ar", { length: 1000 }),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
