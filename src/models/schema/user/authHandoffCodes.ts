import { mysqlTable, varchar, timestamp, char } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { users } from "./Users";

export const authHandoffCodes = mysqlTable("auth_handoff_codes", {
  id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
  codeHash: varchar("code_hash", { length: 64 }).notNull().unique(),
  userId: char("user_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  returnHost: varchar("return_host", { length: 255 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

