import {
  mysqlTable,
  varchar,
  timestamp,
  mysqlEnum,
  char
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { users } from "../../schema";

export const emailVerifications = mysqlTable("email_verifications", {
  id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
  userId: char("user_id", { length: 36 }).notNull().references(() => users.id),
  code: varchar("code", { length: 255 }).notNull(),
  purpose: mysqlEnum("purpose", ["verify_email", "reset_password"]).default("verify_email"),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});