// src/controllers/admin/platformPaymentSettings.ts
// Admin endpoints for managing the platform-level SYSTEM-visa gateway fee settings.
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { platformPaymentSettings } from "../../models/schema";
import { SuccessResponse } from "../../utils/response";
import {
    getSystemVisaSettings,
    invalidateSystemVisaSettingsCache,
} from "../../utils/getSystemVisaSettings";

const roundMoney = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ==========================================
// GET /admin/platform-payment-settings
// ==========================================
export const getPlatformPaymentSettings = async (req: Request, res: Response) => {
    const settings = await getSystemVisaSettings();

    // Also include the updatedAt and updatedBy from DB (not in the cache object)
    const [row] = await db.select().from(platformPaymentSettings).limit(1);

    return SuccessResponse(res, {
        message: "Platform payment settings fetched successfully",
        data: {
            percentageValue: settings.percentageValue,
            fixedValue: settings.fixedValue,
            tax: settings.tax,
            updatedAt: row?.updatedAt ?? null,
            updatedBy: row?.updatedBy ?? null,
        },
    });
};

// ==========================================
// PUT /admin/platform-payment-settings
// ==========================================
export const updatePlatformPaymentSettings = async (
    req: Request | any,
    res: Response
) => {
    const { percentageValue, fixedValue, tax } = req.body as {
        percentageValue: number;
        fixedValue: number;
        tax: number;
    };

    const adminId: string | null = req.user?.id ?? null;

    const pVal = roundMoney(percentageValue);
    const fVal = roundMoney(fixedValue);
    const tVal = roundMoney(tax);

    // Upsert the singleton row (id = 1).
    // We try UPDATE first; if no rows were affected we INSERT the seed row.
    const [existing] = await db.select({ id: platformPaymentSettings.id }).from(platformPaymentSettings).limit(1);

    if (existing) {
        await db.update(platformPaymentSettings).set({
            percentageValue: pVal.toFixed(4),
            fixedValue: fVal.toFixed(2),
            tax: tVal.toFixed(2),
            updatedAt: new Date(),
            updatedBy: adminId ?? undefined,
        });
    } else {
        await db.insert(platformPaymentSettings).values({
            percentageValue: pVal.toFixed(4),
            fixedValue: fVal.toFixed(2),
            tax: tVal.toFixed(2),
            updatedAt: new Date(),
            updatedBy: adminId ?? undefined,
        });
    }

    // Invalidate the in-process cache so subsequent orders pick up the new values immediately
    invalidateSystemVisaSettingsCache();

    return SuccessResponse(res, {
        message: "Platform payment settings updated successfully",
        data: { percentageValue: pVal, fixedValue: fVal, tax: tVal },
    });
};
