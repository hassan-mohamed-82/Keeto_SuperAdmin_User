import { mysqlTable, varchar, char, timestamp, text, boolean, mysqlEnum, json } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { users } from "../user/Users";
import { restaurants } from "./restaurants";

export const notifications = mysqlTable("notifications", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    recipientType: mysqlEnum("recipient_type", ["user", "restaurant"]).notNull(),
    
    // ID of the user OR the restaurant, depending on recipientType
    recipientId: char("recipient_id", { length: 36 }).notNull(),

    title: varchar("title", { length: 255 }).notNull(),
    body: text("body").notNull(),
    
    // Additional payload data (e.g. orderId, status)
    data: json("data"),

    isRead: boolean("is_read").default(false),
    
    createdAt: timestamp("created_at").defaultNow(),
});
