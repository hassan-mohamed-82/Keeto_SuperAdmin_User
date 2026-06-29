import { Request, Response } from "express";
import appleSignin from "apple-signin-auth";
import jwt from "jsonwebtoken";
import { users, restaurant_users } from "../models/schema";
import { db } from "../models/connection";
import { eq, or, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

export const verifyAppleToken = async (req: Request, res: Response) => {
  // الـ Frontend (سواء الموبايل أو الويب) سيرسل الـ token.
  // ملاحظة: أبل ترسل الاسم الكامل أول مرة فقط، لذا يجب على الـ Frontend تمرير fullName كخيار إضافي.
  const { token, restaurantId, fullName } = req.body;

  if (!token) {
    return res.status(400).json({ success: false, message: "Token is required" });
  }

  try {
    // 1️⃣ التحقق من صحة الـ Token مع سيرفرات أبل
    const payload = await appleSignin.verifyIdToken(token, {
      // نقبل الطلبات القادمة من تطبيق الـ iOS أو موقع الـ Web
      audience: [
        process.env.APPLE_CLIENT_ID_IOS!,
        process.env.APPLE_CLIENT_ID_WEB!
      ],
      ignoreExpiration: true, // يفضل تفعيلها في بيئة التطوير لتجنب مشاكل الوقت
    });

    const email = payload.email!;
    const appleId = payload.sub; // المعرف الفريد للمستخدم في أبل

    // 2️⃣ البحث عن المستخدم في قاعدة البيانات عبر Drizzle
    const existingUsers = await db
      .select()
      .from(users)
      .where(or(eq(users.appleId, appleId), eq(users.email, email)))
      .limit(1);

    let user = existingUsers[0];
    let isNewUser = false;

    // 3️⃣ إنشاء مستخدم جديد إذا لم يكن موجوداً
    if (!user) {
      isNewUser = true;
      const newId = uuidv4();
      // إذا لم يرسل الـ Frontend اسماً، نستخدم أول جزء من الإيميل كحل بديل
      const finalName = fullName || email.split("@")[0];

      await db.insert(users).values({
        id: newId,
        appleId,
        email,
        name: finalName,
        isVerified: true,
      });

      // إعداد كائن المستخدم لاستخدامه في باقي الكود
      user = { 
        id: newId, 
        name: finalName, 
        email, 
        appleId, 
        status: "active" 
      } as any;
    } else {
      // 4️⃣ إذا كان المستخدم مسجلاً (مثلاً عبر جوجل) وليس لديه appleId، نقوم بربط حسابه
      if (!user.appleId) {
        await db.update(users).set({ appleId }).where(eq(users.id, user.id));
        user.appleId = appleId;
      }
    }

    // 5️⃣ التأكد من أن الحساب غير محظور
    if (user.status === "blocked") {
      return res.status(403).json({ success: false, message: "Your account has been blocked. Please contact support." });
    }

    // 6️⃣ ربط المستخدم بالمطعم في نظام الـ Multi-tenant
    if (restaurantId && isNewUser) {
      const existingLink = await db.select().from(restaurant_users)
        .where(and(eq(restaurant_users.restaurantId, restaurantId), eq(restaurant_users.userId, user.id)))
        .limit(1);
      
      if (existingLink.length === 0) {
        await db.insert(restaurant_users).values({ restaurantId, userId: user.id });
      }
    }

    // 7️⃣ توليد الـ JWT
    const authToken = jwt.sign(
      { 
        id: user.id,
        name: user.name,
        role: "user",
        type: "user",
        restaurantId: restaurantId || null
      }, 
      process.env.JWT_SECRET!, 
      { expiresIn: "7d" }
    );

    // 8️⃣ إرسال الاستجابة بنجاح
    return res.json({
      success: true,
      token: authToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Apple login error:", error);
    res.status(401).json({ success: false, message: "Invalid Apple token" });
  }
};