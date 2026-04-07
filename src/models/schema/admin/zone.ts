import {
    mysqlTable,
    varchar,
    timestamp,
    mysqlEnum,
    json,
    char,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { cities } from "./city";
export const zones = mysqlTable("zones", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    name: varchar("name", { length: 255 }).notNull(),
    displayName: varchar("displayName", { length: 255 }).notNull(),
    lat: varchar("lat", { length: 255 }).notNull(),
    lng: varchar("lng", { length: 255 }).notNull(),
    status: mysqlEnum("status", ["active", "inactive"]).default("active"),
    cityId: char("cityId", { length: 36 }).references(() => cities.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});