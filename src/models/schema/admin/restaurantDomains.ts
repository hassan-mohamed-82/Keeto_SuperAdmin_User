import {
  mysqlTable,
  int,
  char,
  varchar,
  tinyint,
  mysqlEnum,
  timestamp,
} from "drizzle-orm/mysql-core";
import { restaurants } from "./restaurants";

export const restaurantDomains = mysqlTable("restaurant_domains", {
  id: int("id").autoincrement().primaryKey(),

  // FK matches restaurants.id type (char 36 / UUID)
  restaurantId: char("restaurant_id", { length: 36 })
    .notNull()
    .references(() => restaurants.id, { onDelete: "cascade" }),

  // Always stored lowercase; UNIQUE enforced at DB level
  domain: varchar("domain", { length: 255 }).notNull().unique(),

  isApex: tinyint("is_apex").default(0),

  source: mysqlEnum("source", ["external", "managed"]).default("external"),

  // 32-byte hex token used for TXT verification (external domains only)
  verificationToken: varchar("verification_token", { length: 64 }),

  verified: tinyint("verified").default(0),

  sslStatus: mysqlEnum("ssl_status", ["pending", "active", "failed"]).default(
    "pending"
  ),

  lastError: varchar("last_error", { length: 500 }),

  lastCheckedAt: timestamp("last_checked_at"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});
