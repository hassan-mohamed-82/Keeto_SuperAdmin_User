import {
    mysqlTable,
    varchar,
    char,
    boolean,
    timestamp,
    mysqlEnum,
    json
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "./restaurants";

// ==========================================
// 1. تعريف واجهات البيانات (Interfaces) لكل بوابة
// ==========================================

export interface PaymobCredentials {
    secretKey: string;
    publicKey: string;
    integrationId: string;
    hmac: string;
    callbackUrl?: string;
    apiKey?: string;
    iframeId?: string;
}

export interface KashierCredentials {
    mid: string;
    apiKey: string;
    secretKey?: string;
    baseUrl?: string;
}

export type PaymentCredentialsData = PaymobCredentials | KashierCredentials | Record<string, any>;

// ==========================================
// 2. تعريف الجدول باستخدام الـ Type المعرّف
// ==========================================

export const restaurantPaymentCredentials = mysqlTable("restaurant_payment_credentials", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    restaurantId: char("restaurant_id", { length: 36 })
        .notNull()
        .references(() => restaurants.id, { onDelete: "cascade" }),

    provider: mysqlEnum("provider", ["PAYMOB", "KASHIER"]).notNull(),

    title: varchar("title", { length: 255 }).notNull(),
    environment: mysqlEnum("environment", ["LIVE", "TEST"]).default("LIVE"),

    // 💡 استخدام Type المخصص هنا لدعم Paymob و Kashier
    credentials: json("credentials").$type<PaymentCredentialsData>().notNull(),

    logoUrl: varchar("logo_url", { length: 500 }),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});