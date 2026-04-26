import { mysqlTable, varchar, text, timestamp, char, boolean , longtext } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { countries } from "../admin/country";
import { cities } from "../admin/city";
import { zones } from "../admin/zone";
export const users = mysqlTable("users", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    name: varchar("name", { length: 255 }).notNull(),
    photo: varchar("photo", { length: 500 }),
    email: varchar("email", { length: 255 }).notNull().unique(),
    phone: varchar("phone", { length: 20 }).notNull(),
    fcmToken: text("fcm_token"),
    password: varchar("password", { length: 255 }).notNull(),
    isVerified: boolean("is_verified").default(false),
    createdAt: timestamp("created_at").defaultNow(),
});