import { db } from "../models/connection";
import { adminFcmTokens } from "../models/schema";
import { and, eq, ne } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

export type DeviceType = "web" | "android" | "ios";

export function parseDeviceType(v: any): DeviceType | null {
  return v === "ios" || v === "android" || v === "web" ? v : null;
}

export async function registerAdminToken(adminId: string, fcmToken: string, deviceType: DeviceType) {
  // نفس الجهاز كان عند أدمن تاني؟ امسحه منه
  await db.delete(adminFcmTokens).where(and(
    eq(adminFcmTokens.fcmToken, fcmToken),
    ne(adminFcmTokens.adminId, adminId),
  ));

  await db.insert(adminFcmTokens)
    .values({ id: uuidv4(), adminId, fcmToken, deviceType })
    .onDuplicateKeyUpdate({ set: { fcmToken } });
}

// deviceType موجود: يمسح الجهاز ده بس | مش موجود: يمسح كل أجهزة الأدمن
export async function removeAdminToken(adminId: string, deviceType?: DeviceType | null) {
  await db.delete(adminFcmTokens).where(
    deviceType
      ? and(eq(adminFcmTokens.adminId, adminId), eq(adminFcmTokens.deviceType, deviceType))
      : eq(adminFcmTokens.adminId, adminId)
  );
}