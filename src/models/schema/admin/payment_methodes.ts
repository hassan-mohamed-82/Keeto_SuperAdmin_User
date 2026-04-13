// models/paymentMethods.ts
import {
  mysqlTable,
  varchar,
  char,
  boolean,
  timestamp,
  mysqlEnum
} from "drizzle-orm/mysql-core";

import { sql } from "drizzle-orm";

export const paymentMethods = mysqlTable("payment_methods", {
  id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
  name: varchar("name", { length: 100 }).notNull(),
  image: varchar("image", { length: 255 }).notNull(),
  description: varchar("description", { length: 255 }).notNull(),
  type: mysqlEnum("type", ["manual", "automatic"]).notNull(),
  isActive: boolean("is_active").default(true),

  createdAt: timestamp("created_at").defaultNow(),
});