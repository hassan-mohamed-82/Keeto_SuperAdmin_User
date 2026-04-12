import { mysqlTable, varchar, text, timestamp, char, boolean } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { countries } from "./country";
import { cities } from "./city";
import {zones} from "./zone";
export const users = mysqlTable("users", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    phone: varchar("phone", { length: 20 }).notNull(),
    countryId:char("country_id",{length:36}).notNull().references(()=>countries.id),
    cityId:char("city_id",{length:36}).notNull().references(()=>cities.id),
    zoneId:char("zone_id",{length:36}).notNull().references(()=>zones.id),
    address: text("address"), // عنوان العميل
    password: varchar("password", { length: 255 }).notNull(),
    isVerified: boolean("is_verified").default(false),
    createdAt: timestamp("created_at").defaultNow(),
});