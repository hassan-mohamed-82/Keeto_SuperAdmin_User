import { Request, Response } from "express";
import axios from "axios";
import { and, eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { db } from "../models/connection";
import { restaurant_users, users } from "../models/schema";

export const facebookLoginOrSignup = async (req: Request, res: Response) => {
    try {
        const { accessToken, restaurantId } = req.body;

        if (!accessToken) {
            return res.status(400).json({ success: false, message: "Access Token is required" });
        }

        // 1. جلب بيانات اليوزر من الفيس بوك Graph API
        const fbResponse = await axios.get(
            `https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${accessToken}`
        );

        const fbUser = fbResponse.data;
        const fbPhotoUrl = fbUser.picture?.data?.url || null;

        if (!fbUser || !fbUser.id) {
            return res.status(401).json({ success: false, message: "Invalid Facebook access token" });
        }

        // 2. البحث عن اليوزر بالـ Facebook ID
        const existingUser = await db.select().from(users).where(eq(users.facebookId, fbUser.id)).limit(1);
        let userRecord = existingUser[0];

        // 3. البحث بالإيميل لو غير موجود بـ Facebook ID
        if (!userRecord && fbUser.email) {
            const userByEmail = await db.select().from(users).where(eq(users.email, fbUser.email)).limit(1);

            if (userByEmail[0]) {
                // ✅ تحديث السجل في MySQL بدون .returning()
                await db.update(users)
                    .set({ 
                        facebookId: fbUser.id,
                        photo: userByEmail[0].photo || fbPhotoUrl,
                    })
                    .where(eq(users.id, userByEmail[0].id));
                
                // جلب البيانات المحدثة
                const updatedUsers = await db.select().from(users).where(eq(users.id, userByEmail[0].id)).limit(1);
                userRecord = updatedUsers[0];
            }
        }

        // 4. إنشاء مستخدم جديد تماماً في حال عدم وجوده (Signup)
        if (!userRecord) {
            const newUserId = uuidv4();
            
            // ✅ إضافة السجل في MySQL بدون .returning()
            await db.insert(users).values({
                id: newUserId,
                name: fbUser.name,
                email: fbUser.email || null,
                facebookId: fbUser.id,
                photo: fbPhotoUrl,
                isVerified: true,
                isProfileComplete: true,
            });

            // جلب المستخدم الجديد الذي تم إنشاؤه
            const newUsers = await db.select().from(users).where(eq(users.id, newUserId)).limit(1);
            userRecord = newUsers[0];
        } else if (!userRecord.isProfileComplete) {
            await db.update(users).set({ isProfileComplete: true }).where(eq(users.id, userRecord.id));
            userRecord.isProfileComplete = true;
        }

        // 5. فحص حالة الحساب (Blocked)
        if (userRecord.status === "blocked") {
            return res.status(403).json({ success: false, message: "Your account has been blocked. Please contact support." });
        }

        // 6. ربط المستخدم بالمطعم في حالة وجود restaurantId
        if (restaurantId) {
            const existingLink = await db.select().from(restaurant_users)
                .where(and(
                    eq(restaurant_users.restaurantId, restaurantId),
                    eq(restaurant_users.userId, userRecord.id)
                ))
                .limit(1);

            if (existingLink.length === 0) {
                await db.insert(restaurant_users).values({
                    id: uuidv4(),
                    restaurantId,
                    userId: userRecord.id
                });
            }
        }

        // 7. توقيع الـ JWT Token
        const token = jwt.sign(
            { 
                id: userRecord.id,
                name: userRecord.name,
                role: "user",
                type: "user",
                restaurantId: restaurantId || null
            }, 
            process.env.JWT_SECRET || "fallback_secret_key", 
            { expiresIn: "30d" }
        );

        // 8. إرجاع النتيجة
        return res.status(200).json({
            success: true,
            message: "Authentication successful",
            data: {
                user: {
                    id: userRecord.id,
                    name: userRecord.name,
                    email: userRecord.email,
                    photo: userRecord.photo,
                    phone: userRecord.phone,
                    isVerified: userRecord.isVerified,
                    isProfileComplete: userRecord.isProfileComplete ?? true
                },
                token
            }
        });

    } catch (error: any) {
        console.error("Facebook Auth Error:", error.response?.data || error.message);
        return res.status(500).json({ success: false, message: "Internal server error during Facebook Auth" });
    }
};