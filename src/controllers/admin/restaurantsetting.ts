import { Request, Response } from 'express';
import { db } from '../../models/connection'; // تأكد من مسار الاتصال بقاعدة البيانات
import { restaurantSettings, restaurantSchedules } from '../../models/schema';
import { eq } from 'drizzle-orm';

// 1. دالة تحديث الإعدادات (بعد التعديل)
export const updateSettings = async (req: Request, res: Response): Promise<void> => {
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
    await db.transaction(async (tx) => {
      
      // -- أ: تحديث الإعدادات --
      if (Object.keys(finalSettings).length > 0) {
        const existingSettings = await tx.select()
          .from(restaurantSettings)
          .where(eq(restaurantSettings.restaurantId, restaurantId))
          .limit(1);

        // إزالة الحقول التي لا يجب تحديثها
        const { id, restaurantId: restId, ...updatePayload } = finalSettings;

        if (existingSettings.length > 0) {
          if (Object.keys(updatePayload).length > 0) {
            await tx.update(restaurantSettings)
              .set({
                ...updatePayload,
                minOrderAmount: updatePayload.minOrderAmount !== undefined ? String(updatePayload.minOrderAmount) : undefined,
              })
              .where(eq(restaurantSettings.restaurantId, restaurantId));
          }
        } else {
          // في حالة عدم وجود إعدادات سابقة، يتم إنشاؤها
          await tx.insert(restaurantSettings).values({
            ...updatePayload,
            restaurantId,
            minOrderAmount: updatePayload.minOrderAmount !== undefined ? String(updatePayload.minOrderAmount) : undefined,
          });
        }
      }

      // -- ب: تحديث المواعيد والفترات --
      if (schedules && Array.isArray(schedules)) {
        // مسح كل المواعيد القديمة
        await tx.delete(restaurantSchedules)
          .where(eq(restaurantSchedules.restaurantId, restaurantId));

        // إضافة المواعيد الجديدة إن وجدت
        if (schedules.length > 0) {
          const schedulesToInsert = schedules.map((schedule: any) => ({
            restaurantId: restaurantId,
            dayOfWeek: schedule.dayOfWeek,
            isOffDay: schedule.isOffDay,
            // تعيين الأوقات كـ null إذا كان اليوم إجازة
            openingTime: schedule.isOffDay ? null : schedule.openingTime,
            closingTime: schedule.isOffDay ? null : schedule.closingTime,
          }));

          await tx.insert(restaurantSchedules).values(schedulesToInsert);
        }
      }
    });

    res.status(200).json({ 
      success: true, 
      message: "Update settings success" 
    });
};

// 2. دالة جلب الإعدادات (بدون تغييرات جذرية، تعمل بشكل سليم)
export const getSettingsByRestaurantId = async (req: Request, res: Response): Promise<void> => {
    const restaurantId = req.params.restaurantId;
  
    if (!restaurantId || restaurantId === "undefined") {
      res.status(400).json({ success: false, message: "Restaurant id is required" });
      return;
    }
  
    const settings = await db.select()
      .from(restaurantSettings)
      .where(eq(restaurantSettings.restaurantId, restaurantId))
      .limit(1);
      
    const schedules = await db.select()
      .from(restaurantSchedules)
      .where(eq(restaurantSchedules.restaurantId, restaurantId));
  
    let settingsResult = settings[0];
    
    // إنشاء إعدادات افتراضية في حال عدم وجودها مسبقاً
    if (!settingsResult) {
      await db.insert(restaurantSettings).values({ restaurantId });
      const newSettings = await db.select()
        .from(restaurantSettings)
        .where(eq(restaurantSettings.restaurantId, restaurantId))
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