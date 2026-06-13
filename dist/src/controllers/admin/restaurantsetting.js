"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSettingsByRestaurantId = exports.updateSettings = void 0;
const connection_1 = require("../../models/connection"); // تأكد من مسار الاتصال بقاعدة البيانات
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
// 1. دالة تحديث الإعدادات (بعد التعديل)
const updateSettings = async (req, res) => {
    const restaurantId = req.params.restaurantId;
    // سحب schedules و settings وأي بيانات إضافية مبعوتة خارج الـ settings
    const { schedules, settings, ...otherSettings } = req.body;
    if (!restaurantId || restaurantId === "undefined") {
        res.status(400).json({ success: false, message: "Restaurant id is not valid" });
        return;
    }
    // دمج كل الإعدادات في Object واحد لضمان عدم ضياع أي حقول
    const finalSettings = {
        ...(settings || {}),
        ...otherSettings
    };
    // التحقق من وجود بيانات للتحديث
    if (Object.keys(finalSettings).length === 0 && (!schedules || schedules.length === 0)) {
        res.status(400).json({ success: false, message: "No settings or schedules provided in the request body" });
        return;
    }
    // بدأ الـ Transaction لضمان تنفيذ كل العمليات معاً
    await connection_1.db.transaction(async (tx) => {
        // -- أ: تحديث الإعدادات --
        if (Object.keys(finalSettings).length > 0) {
            const existingSettings = await tx.select()
                .from(schema_1.restaurantSettings)
                .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId))
                .limit(1);
            // إزالة الحقول التي لا يجب تحديثها
            const { id, restaurantId: restId, ...updatePayload } = finalSettings;
            if (existingSettings.length > 0) {
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
                // في حالة عدم وجود إعدادات سابقة، يتم إنشاؤها
                await tx.insert(schema_1.restaurantSettings).values({
                    ...updatePayload,
                    restaurantId,
                    minOrderAmount: updatePayload.minOrderAmount !== undefined ? String(updatePayload.minOrderAmount) : undefined,
                });
            }
        }
        // -- ب: تحديث المواعيد والفترات --
        if (schedules && Array.isArray(schedules)) {
            // مسح كل المواعيد القديمة
            await tx.delete(schema_1.restaurantSchedules)
                .where((0, drizzle_orm_1.eq)(schema_1.restaurantSchedules.restaurantId, restaurantId));
            // إضافة المواعيد الجديدة إن وجدت
            if (schedules.length > 0) {
                const schedulesToInsert = schedules.map((schedule) => ({
                    restaurantId: restaurantId,
                    dayOfWeek: schedule.dayOfWeek,
                    isOffDay: schedule.isOffDay,
                    // تعيين الأوقات كـ null إذا كان اليوم إجازة
                    openingTime: schedule.isOffDay ? null : schedule.openingTime,
                    closingTime: schedule.isOffDay ? null : schedule.closingTime,
                }));
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
// 2. دالة جلب الإعدادات (بدون تغييرات جذرية، تعمل بشكل سليم)
const getSettingsByRestaurantId = async (req, res) => {
    const restaurantId = req.params.restaurantId;
    if (!restaurantId || restaurantId === "undefined") {
        res.status(400).json({ success: false, message: "Restaurant id is required" });
        return;
    }
    const settings = await connection_1.db.select()
        .from(schema_1.restaurantSettings)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId))
        .limit(1);
    const schedules = await connection_1.db.select()
        .from(schema_1.restaurantSchedules)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantSchedules.restaurantId, restaurantId));
    let settingsResult = settings[0];
    // إنشاء إعدادات افتراضية في حال عدم وجودها مسبقاً
    if (!settingsResult) {
        await connection_1.db.insert(schema_1.restaurantSettings).values({ restaurantId });
        const newSettings = await connection_1.db.select()
            .from(schema_1.restaurantSettings)
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId))
            .limit(1);
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
