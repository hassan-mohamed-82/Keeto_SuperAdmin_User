"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSettingsByRestaurantId = exports.updateSettings = void 0;
const connection_1 = require("../../models/connection"); // غير المسار حسب مكان ملف اتصال قاعدة البيانات عندك
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const updateSettings = async (req, res) => {
    const restaurantId = req.params.restaurantId;
    const { settings, schedules } = req.body;
    if (!restaurantId || restaurantId === "undefined") {
        res.status(400).json({ success: false, message: "Restaurant id is not valid" });
        return;
    }
    if (!settings && !schedules) {
        res.status(400).json({ success: false, message: "No settings or schedules provided in the request body" });
        return;
    }
    // بدأ الـ Transaction
    await connection_1.db.transaction(async (tx) => {
        // 1. تحديث الإعدادات (لو مبعوتة)
        if (settings && Object.keys(settings).length > 0) {
            const existingSettings = await tx.select().from(schema_1.restaurantSettings).where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId)).limit(1);
            if (existingSettings.length > 0) {
                // Remove id and restaurantId to prevent updating primary keys
                const { id, restaurantId: restId, ...updatePayload } = settings;
                if (Object.keys(updatePayload).length > 0) {
                    await tx.update(schema_1.restaurantSettings)
                        .set({
                        ...updatePayload,
                        minOrderAmount: updatePayload.minOrderAmount !== undefined ? String(updatePayload.minOrderAmount) : undefined,
                    })
                        .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId));
                }
            }
            else {
                const { id, restaurantId: restId, ...insertPayload } = settings;
                await tx.insert(schema_1.restaurantSettings).values({
                    ...insertPayload,
                    restaurantId,
                    minOrderAmount: insertPayload.minOrderAmount !== undefined ? String(insertPayload.minOrderAmount) : undefined,
                });
            }
        }
        // 2. تحديث المواعيد والفترات (لو مبعوتة)
        if (schedules && Array.isArray(schedules)) {
            // خطوة أ: مسح كل المواعيد القديمة للمطعم ده
            await tx.delete(schema_1.restaurantSchedules)
                .where((0, drizzle_orm_1.eq)(schema_1.restaurantSchedules.restaurantId, restaurantId));
            // لو المصفوفة مش فاضية، هنضيف الجديد
            if (schedules.length > 0) {
                // تجهيز الداتا الجديدة للـ Insert
                const schedulesToInsert = schedules.map((schedule) => ({
                    restaurantId: restaurantId,
                    dayOfWeek: schedule.dayOfWeek,
                    isOffDay: schedule.isOffDay,
                    // لو اليوم إجازة، هنخلي الأوقات null لضمان نظافة الداتا
                    openingTime: schedule.isOffDay ? null : schedule.openingTime,
                    closingTime: schedule.isOffDay ? null : schedule.closingTime,
                }));
                // خطوة ب: إضافة المواعيد والفترات الجديدة
                await tx.insert(schema_1.restaurantSchedules).values(schedulesToInsert);
            }
        }
    });
    res.status(200).json({
        success: true,
        message: "Update settings success"
    });
};
exports.updateSettings = updateSettings;
const getSettingsByRestaurantId = async (req, res) => {
    const restaurantId = req.params.restaurantId;
    if (!restaurantId) {
        res.status(400).json({ success: false, message: "Restaurant id is required" });
        return;
    }
    const settings = await connection_1.db.select().from(schema_1.restaurantSettings).where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId)).limit(1);
    const schedules = await connection_1.db.select().from(schema_1.restaurantSchedules).where((0, drizzle_orm_1.eq)(schema_1.restaurantSchedules.restaurantId, restaurantId));
    let settingsResult = settings[0];
    // لو مفيش إعدادات خالص للمطعم ده، هنكريتله إعدادات افتراضية
    if (!settingsResult) {
        await connection_1.db.insert(schema_1.restaurantSettings).values({ restaurantId });
        const newSettings = await connection_1.db.select().from(schema_1.restaurantSettings).where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId)).limit(1);
        settingsResult = newSettings[0];
    }
    res.status(200).json({
        success: true,
        data: {
            settings: settingsResult,
            schedules: schedules || []
        }
    });
};
exports.getSettingsByRestaurantId = getSettingsByRestaurantId;
