import { Request, Response } from "express";
import axios from "axios";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { db } from "../models/connection"; // مسار الاتصال بقاعدة البيانات
import { users } from "../models/schema"; // مسار الـ schema بتاعك

export const facebookLoginOrSignup = async (req: Request, res: Response) => {
    try {
        const { accessToken, fcmToken } = req.body;

        if (!accessToken) {
            return res.status(400).json({ success: false, message: "Access Token is required" });
        }

        // 1. جلب بيانات اليوزر من الفيس بوك (الاسم، الإيميل، والصورة بجودة عالية)
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

        // 3. لو مش موجود بالـ Facebook ID، ندور بالإيميل (عشان لو مسجل قبل كده عادي)
        if (!userRecord && fbUser.email) {
            const userByEmail = await db.select().from(users).where(eq(users.email, fbUser.email)).limit(1);

            if (userByEmail[0]) {
                // نربط الحساب القديم بالفيس بوك ونحدث الـ FCM Token لو مبعوت
                await db.update(users)
                    .set({ 
                        facebookId: fbUser.id,
                        photo: userByEmail[0].photo || fbPhotoUrl, // نحط صورة الفيس لو معندوش صورة
                        fcmToken: fcmToken || userByEmail[0].fcmToken
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
                fcmToken: fcmToken || null,
                isVerified: true, // متوثق من الفيس بوك
                // phone & password will be null
            });

            // نجيب اليوزر بعد ما اتعمله Insert عشان محتاجين الـ ID بتاعه
            const newUser = await db.select().from(users).where(eq(users.facebookId, fbUser.id)).limit(1);
            userRecord = newUser[0];
        }

        // 5. إنشاء التوكن الخاص بالسيستم بتاعك
        const token = jwt.sign(
            { id: userRecord.id }, 
            process.env.JWT_SECRET || "fallback_secret_key", 
            { expiresIn: "30d" }
        );

        // 6. إرسال الرد للـ Frontend
        return res.status(200).json({
            success: true,
            message: "Authentication successful",
            data: {
                user: {
                    id: userRecord.id,
                    name: userRecord.name,
                    email: userRecord.email,
                    photo: userRecord.photo,
                    phone: userRecord.phone, // لو null الـ Frontend هيعرف إنه محتاج يسأله على الرقم
                    isVerified: userRecord.isVerified
                },
                token
            }
        });

    } catch (error: any) {
        console.error("Facebook Auth Error:", error.response?.data || error.message);
        return res.status(500).json({ success: false, message: "Internal server error during Facebook Auth" });
    }
};