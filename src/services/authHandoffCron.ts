import cron from "node-cron";
import { db } from "../models/connection";
import { authHandoffCodes } from "../models/schema";
import { lt } from "drizzle-orm";

/**
 * Deletes rows in auth_handoff_codes older than 1 hour.
 * Note: Never logs codes or tokens.
 */
export async function cleanupExpiredHandoffCodes(): Promise<number> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  try {
    const result = await db
      .delete(authHandoffCodes)
      .where(lt(authHandoffCodes.createdAt, oneHourAgo));

    const affected = (result as any)?.[0]?.affectedRows || 0;
    return affected;
  } catch (err) {
    console.error("[AuthHandoffCron] Failed to clean up expired handoff codes");
    return 0;
  }
}

/**
 * Initializes the Auth Handoff cleanup job.
 * Runs every 15 minutes.
 */
export function initAuthHandoffCron() {
  cron.schedule("*/15 * * * *", async () => {
    try {
      await cleanupExpiredHandoffCodes();
    } catch (err) {
      console.error("[AuthHandoffCron] Scheduled job encountered an error");
    }
  });

  console.log("🕒 Auth Handoff Cleanup Cron initialized (runs every 15 minutes).");
}

