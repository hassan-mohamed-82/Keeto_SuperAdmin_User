import { mysqlTable, varchar, char, timestamp, int, mysqlEnum } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

export const sales = mysqlTable("sales", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    name: varchar("name", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 50 }),
    email: varchar("email", { length: 255 }).unique(),
    password: varchar("password", { length: 255 }),
    
    // البوينتس الخاصة بمندوب المبيعات
    points: int("points").default(0), 
    
    status: mysqlEnum("status", ["active", "inactive"]).default("active"),
    
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});