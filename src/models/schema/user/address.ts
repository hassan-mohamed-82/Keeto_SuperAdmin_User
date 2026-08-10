import {
    mysqlTable,
    varchar,
    timestamp,
    mysqlEnum,
    json,
    char,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { users ,} from "./Users";
import {zones} from "../admin/zone"

export const addresses = mysqlTable("addresses", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    userId: char("user_id", { length: 36 }).references(() => users.id).notNull(),
    zoneId: char("zone_id", { length: 36 }).references(() => zones.id).notNull(),
    type: mysqlEnum("type", ["home", "work", "other"]).default("home"),
    title: varchar("title", { length: 255 }).notNull(),
    lat:varchar("lat", { length: 255 }).notNull(),
    lng:varchar("lng", { length: 255 }).notNull(),
    street: varchar("street", { length: 255 }).notNull(),
    number: varchar("number", { length: 20 }).notNull(),
    floor: varchar("floor", { length: 20 }),
    landmark: varchar("landmark", { length: 500 }),
    location: varchar("location", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
});