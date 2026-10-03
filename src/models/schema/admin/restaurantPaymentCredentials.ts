import {
    mysqlTable,
    varchar,
    char,
    boolean,
    timestamp,
    mysqlEnum,
    json,
    decimal,
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

export interface GeideaCredentials {
    publicKey: string;
    apiPassword: string;
    name?: string;
    logoUrl?: string;
    environment?: string;
    callbackUrl?: string;
    returnUrl?: string;
}

export type PaymentCredentialsData = PaymobCredentials | KashierCredentials | GeideaCredentials | Record<string, any>;

// ==========================================
// 2. تعريف الجدول باستخدام الـ Type المعرّف
// ==========================================

export const restaurantPaymentCredentials = mysqlTable("restaurant_payment_credentials", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    restaurantId: char("restaurant_id", { length: 36 })
        .notNull()
        .references(() => restaurants.id, { onDelete: "cascade" }),

    provider: mysqlEnum("provider", ["PAYMOB", "KASHIER", "GEIDEA"]).notNull(),

    title: varchar("title", { length: 255 }).notNull(),
    environment: mysqlEnum("environment", ["LIVE", "TEST"]).default("LIVE"),

    // 💡 استخدام Type المخصص هنا لدعم Paymob و Kashier و Geidea
    credentials: json("credentials").$type<PaymentCredentialsData>().notNull(),

    // 💡 إعدادات عمولة الفيزا للبوابة المخصصة (Custom Gateway Commission)
    percentageValue: decimal("percentage_value", { precision: 10, scale: 2 }).default("0.00"),
    fixedValue: decimal("fixed_value", { precision: 10, scale: 2 }).default("0.00"),
    tax: decimal("tax", { precision: 10, scale: 2 }).default("0.00"),

    logoUrl: varchar("logo_url", { length: 500 }),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});