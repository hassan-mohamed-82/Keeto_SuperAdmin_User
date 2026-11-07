"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupExpiredHandoffCodes = cleanupExpiredHandoffCodes;
exports.initAuthHandoffCron = initAuthHandoffCron;
const node_cron_1 = __importDefault(require("node-cron"));
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
/**
 * Deletes rows in auth_handoff_codes older than 1 hour.
 * Note: Never logs codes or tokens.
 */
async function cleanupExpiredHandoffCodes() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    try {
        const result = await connection_1.db
            .delete(schema_1.authHandoffCodes)
            .where((0, drizzle_orm_1.lt)(schema_1.authHandoffCodes.createdAt, oneHourAgo));
        const affected = result?.[0]?.affectedRows || 0;
        return affected;
    }
    catch (err) {
        console.error("[AuthHandoffCron] Failed to clean up expired handoff codes");
        return 0;
    }
}
/**
 * Initializes the Auth Handoff cleanup job.
 * Runs every 15 minutes.
 */
function initAuthHandoffCron() {
    node_cron_1.default.schedule("*/15 * * * *", async () => {
        try {
            await cleanupExpiredHandoffCodes();
        }
        catch (err) {
            console.error("[AuthHandoffCron] Scheduled job encountered an error");
        }
    });
    console.log("🕒 Auth Handoff Cleanup Cron initialized (runs every 15 minutes).");
}
