// models/paymentMethods.ts
import {
  mysqlTable,
  varchar,
  char,
  boolean,
  timestamp,
  mysqlEnum
, longtext } from "drizzle-orm/mysql-core";

import { sql } from "drizzle-orm";

export const paymentMethods = mysqlTable("payment_methods", {
  id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
  name: varchar("name", { length: 100 }).notNull(),
  nameAr: varchar("name_ar", { length: 100 }).notNull().default(''),

  isActive: boolean("is_active").default(true),

  createdAt: timestamp("created_at").defaultNow(),
});