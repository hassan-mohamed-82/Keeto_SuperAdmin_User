// import { Request, Response } from "express";
// import appleSignin from "apple-signin-auth";
// import jwt from "jsonwebtoken";
// import { users, restaurant_users } from "../models/schema";
// import { db } from "../models/connection";
// import { eq, or, and } from "drizzle-orm";
// import { v4 as uuidv4 } from "uuid";

// export const verifyAppleToken = async (req: Request, res: Response) => {
//   // الـ Frontend (سواء الموبايل أو الويب) سيرسل الـ token.
//   // ملاحظة: أبل ترسل الاسم الكامل أول مرة فقط، لذا يجب على الـ Frontend تمرير fullName كخيار إضافي.
//   const { token, restaurantId, fullName } = req.body;

//   if (!token) {
//     return res.status(400).json({ success: false, message: "Token is required" });
//   }

//   try {
//     // 1️⃣ التحقق من صحة الـ Token مع سيرفرات أبل
//     const payload = await appleSignin.verifyIdToken(token, {
//       // نقبل الطلبات القادمة من تطبيق الـ iOS أو موقع الـ Web
//       audience: [
//         process.env.APPLE_CLIENT_ID_IOS!,
//         process.env.APPLE_CLIENT_ID_WEB!
//       ],
//       ignoreExpiration: true, // يفضل تفعيلها في بيئة التطوير لتجنب مشاكل الوقت
//     });

//     const email = payload.email!;
//     const appleId = payload.sub; // المعرف الفريد للمستخدم في أبل

//     // 2️⃣ البحث عن المستخدم في قاعدة البيانات عبر Drizzle
//     const existingUsers = await db
//       .select()
//       .from(users)
//       .where(or(eq(users.appleId, appleId), eq(users.email, email)))
//       .limit(1);

//     let user = existingUsers[0];
//     let isNewUser = false;

//     // 3️⃣ إنشاء مستخدم جديد إذا لم يكن موجوداً
//     if (!user) {
//       isNewUser = true;
//       const newId = uuidv4();
//       // إذا لم يرسل الـ Frontend اسماً، نستخدم أول جزء من الإيميل كحل بديل
//       const finalName = fullName || email.split("@")[0];

//       await db.insert(users).values({
//         id: newId,
//         appleId,
//         email,
//         name: finalName,
//         isVerified: true,
//       });

//       // إعداد كائن المستخدم لاستخدامه في باقي الكود
//       user = { 
//         id: newId, 
//         name: finalName, 
//         email, 
//         appleId, 
//         status: "active" 
//       } as any;
//     } else {
//       // 4️⃣ إذا كان المستخدم مسجلاً (مثلاً عبر جوجل) وليس لديه appleId، نقوم بربط حسابه
//       if (!user.appleId) {
//         await db.update(users).set({ appleId }).where(eq(users.id, user.id));
//         user.appleId = appleId;
//       }
//     }

//     // 5️⃣ التأكد من أن الحساب غير محظور
//     if (user.status === "blocked") {
//       return res.status(403).json({ success: false, message: "Your account has been blocked. Please contact support." });
//     }

//     // 6️⃣ ربط المستخدم بالمطعم في نظام الـ Multi-tenant
//     if (restaurantId && isNewUser) {
//       const existingLink = await db.select().from(restaurant_users)
//         .where(and(eq(restaurant_users.restaurantId, restaurantId), eq(restaurant_users.userId, user.id)))
//         .limit(1);

//       if (existingLink.length === 0) {
//         await db.insert(restaurant_users).values({ restaurantId, userId: user.id });
//       }
//     }

//     // 7️⃣ توليد الـ JWT
//     const authToken = jwt.sign(
//       { 
//         id: user.id,
//         name: user.name,
//         role: "user",
//         type: "user",
//         restaurantId: restaurantId || null
//       }, 
//       process.env.JWT_SECRET!, 
//       { expiresIn: "7d" }
//     );

//     // 8️⃣ إرسال الاستجابة بنجاح
//     return res.json({
//       success: true,
//       token: authToken,
//       user: {
//         id: user.id,
//         name: user.name,
//         email: user.email,
//       },
//     });
//   } catch (error) {
//     console.error("Apple login error:", error);
//     res.status(401).json({ success: false, message: "Invalid Apple token" });
//   }
// };



// import { Request, Response } from "express";
// import appleSignin from "apple-signin-auth";
// import jwt from "jsonwebtoken";
// import { users, restaurant_users } from "../models/schema";
// import { db } from "../models/connection";
// import { eq, or, and } from "drizzle-orm";
// import { v4 as uuidv4 } from "uuid";

// export const verifyAppleToken = async (req: Request, res: Response) => {
//   // الـ Frontend (سواء الموبايل أو الويب) سيرسل الـ token.
//   // ملاحظة: أبل ترسل الاسم الكامل أول مرة فقط، لذا يجب على الـ Frontend تمرير fullName كخيار إضافي.
//   const { token, restaurantId, fullName } = req.body;

//   if (!token) {
//     return res.status(400).json({ success: false, message: "Token is required" });
//   }

//   try {
//     // 1️⃣ التحقق من صحة الـ Token مع سيرفرات أبل
//     const payload = await appleSignin.verifyIdToken(token, {
//       // نقبل الطلبات القادمة من تطبيق الـ iOS أو موقع الـ Web
//       audience: [
//         process.env.APPLE_CLIENT_ID_IOS!,
//         process.env.APPLE_CLIENT_ID_WEB!
//       ],
//       ignoreExpiration: true, // يفضل تفعيلها في بيئة التطوير لتجنب مشاكل الوقت
//     });

//     const email = payload.email!;
//     const appleId = payload.sub; // المعرف الفريد للمستخدم في أبل

//     // 2️⃣ البحث عن المستخدم في قاعدة البيانات عبر Drizzle
//     const existingUsers = await db
//       .select()
//       .from(users)
//       .where(or(eq(users.appleId, appleId), eq(users.email, email)))
//       .limit(1);

//     let user = existingUsers[0];
//     let isNewUser = false;

//     // 3️⃣ إنشاء مستخدم جديد إذا لم يكن موجوداً
//     if (!user) {
//       isNewUser = true;
//       const newId = uuidv4();
//       // إذا لم يرسل الـ Frontend اسماً، نستخدم أول جزء من الإيميل كحل بديل
//       const finalName = fullName || email.split("@")[0];

//       await db.insert(users).values({
//         id: newId,
//         appleId,
//         email,
//         name: finalName,
//         isVerified: true,
//       });

//       // إعداد كائن المستخدم لاستخدامه في باقي الكود
//       user = { 
//         id: newId, 
//         name: finalName, 
//         email, 
//         appleId, 
//         status: "active" 
//       } as any;
//     } else {
//       // 4️⃣ إذا كان المستخدم مسجلاً (مثلاً عبر جوجل) وليس لديه appleId، نقوم بربط حسابه
//       if (!user.appleId) {
//         await db.update(users).set({ appleId }).where(eq(users.id, user.id));
//         user.appleId = appleId;
//       }
//     }

//     // 5️⃣ التأكد من أن الحساب غير محظور
//     if (user.status === "blocked") {
//       return res.status(403).json({ success: false, message: "Your account has been blocked. Please contact support." });
//     }

//     // 6️⃣ ربط المستخدم بالمطعم في نظام الـ Multi-tenant
//     if (restaurantId && isNewUser) {
//       const existingLink = await db.select().from(restaurant_users)
//         .where(and(eq(restaurant_users.restaurantId, restaurantId), eq(restaurant_users.userId, user.id)))
//         .limit(1);

//       if (existingLink.length === 0) {
//         await db.insert(restaurant_users).values({ restaurantId, userId: user.id });
//       }
//     }

//     // 7️⃣ توليد الـ JWT
//     const authToken = jwt.sign(
//       { 
//         id: user.id,
//         name: user.name,
//         role: "user",
//         type: "user",
//         restaurantId: restaurantId || null
//       }, 
//       process.env.JWT_SECRET!, 
//       { expiresIn: "7d" }
//     );

//     // 8️⃣ إرسال الاستجابة بنجاح
//     return res.json({
//       success: true,
//       token: authToken,
//       user: {
//         id: user.id,
//         name: user.name,
//         email: user.email,
//       },
//     });
//   } catch (error) {
//     console.error("Apple login error:", error);
//     res.status(401).json({ success: false, message: "Invalid Apple token" });
//   }
// };


// import { Request, Response } from "express";
// import appleSignin from "apple-signin-auth";
// import jwt from "jsonwebtoken";
// import { users, restaurant_users, restaurants } from "../models/schema"; // 👈 أضفنا جدول restaurants
// import { db } from "../models/connection";
// import { eq, or, and } from "drizzle-orm";
// import { v4 as uuidv4 } from "uuid";

// export const verifyAppleToken = async (req: Request, res: Response) => {
//   const { token, restaurantId, fullName } = req.body;

//   if (!token) {
//     return res.status(400).json({ success: false, message: "Token is required" });
//   }

//   try {
//     // 1️⃣ جلب الـ appBundleId الخاص بالمطعم من قاعدة البيانات
//     let allowedAudiences: string[] = [process.env.APPLE_CLIENT_ID_WEB!];

//     if (restaurantId) {
//       const [restaurant] = await db
//         .select({ appBundleId: restaurants.appBundleId })
//         .from(restaurants)
//         .where(eq(restaurants.id, restaurantId))
//         .limit(1);

//       if (restaurant?.appBundleId) {
//         allowedAudiences.push(restaurant.appBundleId);
//       }
//     }

//     // 2️⃣ التحقق من صحة الـ Token مع سيرفرات أبل باستخدام الـ Bundle ID الديناميكي
//     const payload = await appleSignin.verifyIdToken(token, {
//       audience: allowedAudiences,
//       ignoreExpiration: process.env.NODE_ENV !== "production", // تفعيلها فقط في بيئة التطوير
//     });

//     const email = payload.email!;
//     const appleId = payload.sub; // المعرف الفريد للمستخدم في أبل

//     // 3️⃣ البحث عن المستخدم في قاعدة البيانات عبر Drizzle
//     const existingUsers = await db
//       .select()
//       .from(users)
//       .where(or(eq(users.appleId, appleId), eq(users.email, email)))
//       .limit(1);

//     let user = existingUsers[0];
//     let isNewUser = false;

//     // 4️⃣ إنشاء مستخدم جديد إذا لم يكن موجوداً
//     if (!user) {
//       isNewUser = true;
//       const newId = uuidv4();
//       const finalName = fullName || email.split("@")[0];

//       await db.insert(users).values({
//         id: newId,
//         appleId,
//         email,
//         name: finalName,
//         isVerified: true,
//       });

//       user = {
//         id: newId,
//         name: finalName,
//         email,
//         appleId,
//         status: "active"
//       } as any;
//     } else {
//       // 5️⃣ ربط الـ appleId إذا كان المستخدم مسجلاً مسبقاً بوسيلة أخرى
//       if (!user.appleId) {
//         await db.update(users).set({ appleId }).where(eq(users.id, user.id));
//         user.appleId = appleId;
//       }
//     }

//     // 6️⃣ التأكد من أن الحساب غير محظور
//     if (user.status === "blocked") {
//       return res.status(403).json({ success: false, message: "Your account has been blocked. Please contact support." });
//     }

//     // 7️⃣ ربط المستخدم بالمطعم في نظام الـ Multi-tenant
//     if (restaurantId) {
//       const existingLink = await db
//         .select()
//         .from(restaurant_users)
//         .where(and(eq(restaurant_users.restaurantId, restaurantId), eq(restaurant_users.userId, user.id)))
//         .limit(1);

//       if (existingLink.length === 0) {
//         await db.insert(restaurant_users).values({ restaurantId, userId: user.id });
//       }
//     }

//     // 8️⃣ توليد الـ JWT
//     const authToken = jwt.sign(
//       {
//         id: user.id,
//         name: user.name,
//         role: "user",
//         type: "user",
//         restaurantId: restaurantId || null
//       },
//       process.env.JWT_SECRET!,
//       { expiresIn: "7d" }
//     );

//     // 9️⃣ إرسال الاستجابة بنجاح
//     return res.json({
//       success: true,
//       token: authToken,
//       user: {
//         id: user.id,
//         name: user.name,
//         email: user.email,
//       },
//     });
//   } catch (error) {
//     console.error("Apple login error:", error);
//     return res.status(401).json({ success: false, message: "Invalid Apple token" });
//   }
// };


import { Request, Response } from "express";
import appleSignin from "apple-signin-auth";
import jwt from "jsonwebtoken";
import { users, restaurant_users, restaurants } from "../models/schema";
import { db } from "../models/connection";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

export const verifyAppleToken = async (req: Request, res: Response) => {
  const { token, fullName } = req.body;
  let { restaurantId } = req.body;

  if (!token) {
    return res.status(400).json({ success: false, message: "Token is required" });
  }

  try {
    const allowedAudiences: string[] = [];

    // Always include the Web Client ID if configured
    if (process.env.APPLE_CLIENT_ID_WEB) {
      allowedAudiences.push(process.env.APPLE_CLIENT_ID_WEB);
    }

    // 1️⃣ Reverse Lookup: Decode token to find Bundle ID if restaurantId was not provided
    if (!restaurantId) {
      const decodedToken = jwt.decode(token) as { aud?: string | string[] } | null;

      // Extract audience string (aud can be string or array in JWT spec)
      const tokenAudience = Array.isArray(decodedToken?.aud)
        ? decodedToken?.aud[0]
        : decodedToken?.aud;

      if (tokenAudience) {
        // Find the restaurant matching this appBundleId
        const [foundRestaurant] = await db
          .select({ id: restaurants.id, appBundleId: restaurants.appBundleId })
          .from(restaurants)
          .where(eq(restaurants.appBundleId, tokenAudience))
          .limit(1);

        if (foundRestaurant) {
          restaurantId = foundRestaurant.id;
          if (foundRestaurant.appBundleId) {
            allowedAudiences.push(foundRestaurant.appBundleId);
          }
        }
      }
    } else {
      // 2️⃣ Fetch appBundleId directly if restaurantId was provided
      const [restaurant] = await db
        .select({ appBundleId: restaurants.appBundleId })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);

      if (!restaurant) {
        return res.status(404).json({ success: false, message: "Restaurant not found" });
      }

      if (restaurant.appBundleId) {
        allowedAudiences.push(restaurant.appBundleId);
      }
    }

    if (allowedAudiences.length === 0) {
      return res.status(500).json({
        success: false,
        message: "No valid Apple Client ID or Bundle ID found for verification"
      });
    }

    // 3️⃣ Verify Apple ID token with dynamic audiences
    const payload = await appleSignin.verifyIdToken(token, {
      audience: allowedAudiences,
      ignoreExpiration: process.env.NODE_ENV !== "production",
    });

    const appleId = payload.sub; // Unique permanent Apple user ID
    const email = payload.email; // May be undefined after first login

    // 4️⃣ Search for existing user (Prioritize appleId to prevent duplicate/accidental accounts)
    let user = null;

    const usersByAppleId = await db
      .select()
      .from(users)
      .where(eq(users.appleId, appleId))
      .limit(1);

    user = usersByAppleId[0];

    // Fallback search by email if appleId not matched yet (for legacy accounts)
    if (!user && email) {
      const usersByEmail = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      user = usersByEmail[0];

      if (user) {
        await db.update(users).set({ appleId }).where(eq(users.id, user.id));
        user.appleId = appleId;
      }
    }

    // 5️⃣ Create user if not exists
    if (!user) {
      const finalEmail = email || `${appleId}@privaterelay.appleid.com`;
      const finalName = fullName || finalEmail.split("@")[0];
      const newId = uuidv4();

      await db.insert(users).values({
        id: newId,
        appleId,
        email: finalEmail,
        name: finalName,
        isVerified: true,
      });

      user = {
        id: newId,
        name: finalName,
        email: finalEmail,
        appleId,
        status: "active",
      } as any;
    }

    // 6️⃣ Check account status
    if (user.status === "blocked") {
      return res.status(403).json({
        success: false,
        message: "Your account has been blocked. Please contact support."
      });
    }

    // 7️⃣ Link user to restaurant in multi-tenant table
    if (restaurantId) {
      const existingLink = await db
        .select()
        .from(restaurant_users)
        .where(
          and(
            eq(restaurant_users.restaurantId, restaurantId),
            eq(restaurant_users.userId, user.id)
          )
        )
        .limit(1);

      if (existingLink.length === 0) {
        await db.insert(restaurant_users).values({
          restaurantId,
          userId: user.id
        });
      }
    }

    // 8️⃣ Generate JWT
    const authToken = jwt.sign(
      {
        id: user.id,
        name: user.name,
        role: "user",
        type: "user",
        restaurantId: restaurantId || null,
      },
      process.env.JWT_SECRET!,
      { expiresIn: "7d" }
    );

    return res.json({
      success: true,
      token: authToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      restaurantId: restaurantId || null,
    });
  } catch (error) {
    console.error("Apple login error:", error);
    return res.status(401).json({ success: false, message: "Invalid Apple token" });
  }
};