"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restaurantDomains = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const restaurants_1 = require("./restaurants");
exports.restaurantDomains = (0, mysql_core_1.mysqlTable)("restaurant_domains", {
    id: (0, mysql_core_1.int)("id").autoincrement().primaryKey(),
    // FK matches restaurants.id type (char 36 / UUID)
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .notNull()
        .references(() => restaurants_1.restaurants.id, { onDelete: "cascade" }),
    // Always stored lowercase; UNIQUE enforced at DB level
    domain: (0, mysql_core_1.varchar)("domain", { length: 255 }).notNull().unique(),
    isApex: (0, mysql_core_1.tinyint)("is_apex").default(0),
    source: (0, mysql_core_1.mysqlEnum)("source", ["external", "managed", "subdomain"]).default("external"),
    // 32-byte hex token used for TXT verification (external domains only)
    verificationToken: (0, mysql_core_1.varchar)("verification_token", { length: 64 }),
    verified: (0, mysql_core_1.tinyint)("verified").default(0),
    sslStatus: (0, mysql_core_1.mysqlEnum)("ssl_status", ["pending", "active", "failed"]).default("pending"),
    lastError: (0, mysql_core_1.varchar)("last_error", { length: 500 }),
    lastCheckedAt: (0, mysql_core_1.timestamp)("last_checked_at"),
    // ── Phase 2: provisioning tracking ──────────────────────────────────────
    provisionStatus: (0, mysql_core_1.mysqlEnum)("provision_status", [
        "idle",
        "running",
        "done",
        "failed",
    ]).default("idle"),
    /** Last successfully completed provisioning step */
    provisionStep: (0, mysql_core_1.varchar)("provision_step", { length: 30 }),
    /** 1 only when THIS system created the Plesk site (never touch sites we didn't create) */
    pleskSiteCreated: (0, mysql_core_1.tinyint)("plesk_site_created").default(0),
    provisionStartedAt: (0, mysql_core_1.timestamp)("provision_started_at"),
    provisionAttempts: (0, mysql_core_1.int)("provision_attempts").default(0),
    // ── Phase 3: Subdomain source & DNS status ──────────────────────────────
    dnsStatus: (0, mysql_core_1.mysqlEnum)("dns_status", [
        "not_needed",
        "pending",
        "created",
        "manual_required",
    ]).default("not_needed"),
    // ────────────────────────────────────────────────────────────────────────
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
