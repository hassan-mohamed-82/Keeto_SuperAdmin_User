import { mysqlTable, varchar, char, timestamp, int, mysqlEnum } from "drizzle-orm/mysql-core";
import { sql, relations } from "drizzle-orm";
import { food } from "./food";
import { restaurants } from "./restaurants";
import { users } from "../user/Users";

export const redeemRequests = mysqlTable("redeem_requests", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    userId: char("user_id", { length: 36 }).notNull().references(() => users.id),
    restaurantId: char("restaurant_id", { length: 36 }).notNull().references(() => restaurants.id),
    foodId: char("food_id", { length: 36 }).notNull().references(() => food.id),
    
    code: varchar("code", { length: 10 }).notNull().unique(),
    pointsDeducted: int("points_deducted").notNull(),
    
    status: mysqlEnum("status", ["pending", "used", "expired", "cancelled"]).default("pending"),
    
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});