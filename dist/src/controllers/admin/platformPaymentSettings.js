"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePlatformPaymentSettings = exports.getPlatformPaymentSettings = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const response_1 = require("../../utils/response");
const getSystemVisaSettings_1 = require("../../utils/getSystemVisaSettings");
const roundMoney = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
// ==========================================
// GET /admin/platform-payment-settings
// ==========================================
const getPlatformPaymentSettings = async (req, res) => {
    const settings = await (0, getSystemVisaSettings_1.getSystemVisaSettings)();
    // Also include the updatedAt and updatedBy from DB (not in the cache object)
    const [row] = await connection_1.db.select().from(schema_1.platformPaymentSettings).limit(1);
    return (0, response_1.SuccessResponse)(res, {
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
exports.getPlatformPaymentSettings = getPlatformPaymentSettings;
// ==========================================
// PUT /admin/platform-payment-settings
// ==========================================
const updatePlatformPaymentSettings = async (req, res) => {
    const { percentageValue, fixedValue, tax } = req.body;
    const adminId = req.user?.id ?? null;
    const pVal = roundMoney(percentageValue);
    const fVal = roundMoney(fixedValue);
    const tVal = roundMoney(tax);
    // Upsert the singleton row (id = 1).
    // We try UPDATE first; if no rows were affected we INSERT the seed row.
    const [existing] = await connection_1.db.select({ id: schema_1.platformPaymentSettings.id }).from(schema_1.platformPaymentSettings).limit(1);
    if (existing) {
        await connection_1.db.update(schema_1.platformPaymentSettings).set({
            percentageValue: pVal.toFixed(4),
            fixedValue: fVal.toFixed(2),
            tax: tVal.toFixed(2),
            updatedAt: new Date(),
            updatedBy: adminId ?? undefined,
        });
    }
    else {
        await connection_1.db.insert(schema_1.platformPaymentSettings).values({
            percentageValue: pVal.toFixed(4),
            fixedValue: fVal.toFixed(2),
            tax: tVal.toFixed(2),
            updatedAt: new Date(),
            updatedBy: adminId ?? undefined,
        });
    }
    // Invalidate the in-process cache so subsequent orders pick up the new values immediately
    (0, getSystemVisaSettings_1.invalidateSystemVisaSettingsCache)();
    return (0, response_1.SuccessResponse)(res, {
        message: "Platform payment settings updated successfully",
        data: { percentageValue: pVal, fixedValue: fVal, tax: tVal },
    });
};
exports.updatePlatformPaymentSettings = updatePlatformPaymentSettings;
