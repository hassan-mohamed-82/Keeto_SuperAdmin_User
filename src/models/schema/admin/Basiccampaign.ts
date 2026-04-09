import {
    mysqlTable,
    varchar,
    timestamp,
    mysqlEnum,
    json,
    char,
    text,
    time
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

export const basiccampaign = mysqlTable("basiccampaign", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    Title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    image: varchar("image", { length: 255 }),
    status: mysqlEnum("status", ["active", "inactive"]).default("active"),
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date").notNull(),
    dailystarttime: time("daily_start_time").notNull(),
    dailyendtime: time("daily_end_time").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});
