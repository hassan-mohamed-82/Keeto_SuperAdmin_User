import {
    mysqlTable,
    char,
    timestamp,
    mysqlEnum
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "./restaurants";

export type TaxTypeOption = "include" | "exclude";

export const taxTypes = mysqlTable("tax_types", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    restrauntid: char("restrauntid", { length: 36 }).references(() => restaurants.id).notNull(),
    type: mysqlEnum("type", ["include", "exclude"]).default("exclude").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

export const taxType = taxTypes;

export type TaxTypeRecord = typeof taxTypes.$inferSelect;
export type NewTaxType = typeof taxTypes.$inferInsert;
