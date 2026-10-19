import { char, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

export const videos = mysqlTable("videos", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    title: varchar("title", { length: 255 }).notNull(),
    titleAr: varchar("title_ar", { length: 255 }).notNull(),
    description: text("description"),
    descriptionAr: text("description_ar"),
    videoUrl: varchar("video_url", { length: 1000 }).notNull(),
    thumbnailUrl: varchar("thumbnail_url", { length: 1000 }),
    status: mysqlEnum("status", ["active", "inactive"]).default("active"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

export type Video = typeof videos.$inferSelect;
export type NewVideo = typeof videos.$inferInsert;
