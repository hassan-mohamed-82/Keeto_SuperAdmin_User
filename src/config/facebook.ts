import { Request, Response } from "express";
import axios from "axios";
import { and, eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { db } from "../models/connection"; // مسار الاتصال بقاعدة البيانات
import { restaurant_users, users } from "../models/schema"; // مسار الـ schema بتاعك

export const facebookLoginOrSignup = async (req: Request, res: Response) => {
    try {
        const { accessToken, restaurantId } = req.body; // ⬅️ إضافة استقبال restaurantId

        if (!accessToken) {
            return res.status(400).json({ success: false, message: "Access Token is required" });
        }

        // 1. جلب بيانات اليوزر من الفيس بوك
        const fbResponse = await axios.get(
            `https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${accessToken}`
        );
        
        const fbUser = fbResponse.data;
        const fbPhotoUrl = fbUser.picture?.data?.url || null;

        if (!fbUser.id) {
            return res.status(401).json({ success: false, message: "Invalid Facebook token" });
        }

        // 2. البحث عن اليوزر في الداتا بيز بالـ Facebook ID
        let existingUser = await db.select().from(users).where(eq(users.facebookId, fbUser.id)).limit(1);
        let userRecord = existingUser[0];

        // 3. لو مش موجود بالـ Facebook ID، ندور بالإيميل
        if (!userRecord && fbUser.email) {
            const userByEmail = await db.select().from(users).where(eq(users.email, fbUser.email)).limit(1);

            if (userByEmail[0]) {
                await db.update(users)
                    .set({ 
                        facebookId: fbUser.id,
                        photo: userByEmail[0].photo || fbPhotoUrl,
                    })
                    .where(eq(users.id, userByEmail[0].id));
                
                userRecord = { ...userByEmail[0], facebookId: fbUser.id, photo: userByEmail[0].photo || fbPhotoUrl };
            }
        }

        // 4. لو اليوزر جديد تماماً (Signup)
        if (!userRecord) {
            await db.insert(users).values({
                name: fbUser.name,
                email: fbUser.email || null,
                facebookId: fbUser.id,
                photo: fbPhotoUrl,
                isVerified: true,
                isProfileComplete: true,
            });

            const newUser = await db.select().from(users).where(eq(users.facebookId, fbUser.id)).limit(1);
            userRecord = newUser[0];
        } else if (!userRecord.isProfileComplete) {
            await db.update(users).set({ isProfileComplete: true }).where(eq(users.id, userRecord.id));
            userRecord.isProfileComplete = true;
        }

        // 5. Check account status
        if (userRecord.status === "blocked") {
            return res.status(403).json({ success: false, message: "Your account has been blocked. Please contact support." });
        }

        // 6. 🔗 Link user to restaurant in multi-tenant table (مضافة لضمان ربط كل المطاعم)
        if (restaurantId) {
            const existingLink = await db.select().from(restaurant_users)
                .where(and(
                    eq(restaurant_users.restaurantId, restaurantId),
                    eq(restaurant_users.userId, userRecord.id)
                ))
                .limit(1);

            if (existingLink.length === 0) {
                await db.insert(restaurant_users).values({
                    restaurantId,
                    userId: userRecord.id
                });
            }
        }

        // 7. إنشاء التوكن (تم موائمته مع باقي الـ Auth Handlers)
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

        // 8. إرسال الرد للـ Frontend
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