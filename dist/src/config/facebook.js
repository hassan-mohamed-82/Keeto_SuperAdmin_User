"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.facebookLoginOrSignup = void 0;
const axios_1 = __importDefault(require("axios"));
const drizzle_orm_1 = require("drizzle-orm");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const connection_1 = require("../models/connection"); // مسار الاتصال بقاعدة البيانات
const schema_1 = require("../models/schema"); // مسار الـ schema بتاعك
const facebookLoginOrSignup = async (req, res) => {
    try {
        const { accessToken, fcmToken } = req.body;
        if (!accessToken) {
            return res.status(400).json({ success: false, message: "Access Token is required" });
        }
        // 1. جلب بيانات اليوزر من الفيس بوك (الاسم، الإيميل، والصورة بجودة عالية)
        const fbResponse = await axios_1.default.get(`https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${accessToken}`);
        const fbUser = fbResponse.data;
        const fbPhotoUrl = fbUser.picture?.data?.url || null;
        if (!fbUser.id) {
            return res.status(401).json({ success: false, message: "Invalid Facebook token" });
        }
        // 2. البحث عن اليوزر في الداتا بيز بالـ Facebook ID
        let existingUser = await connection_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.facebookId, fbUser.id)).limit(1);
        let userRecord = existingUser[0];
        // 3. لو مش موجود بالـ Facebook ID، ندور بالإيميل (عشان لو مسجل قبل كده عادي)
        if (!userRecord && fbUser.email) {
            const userByEmail = await connection_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.email, fbUser.email)).limit(1);
            if (userByEmail[0]) {
                // نربط الحساب القديم بالفيس بوك ونحدث الـ FCM Token لو مبعوت
                await connection_1.db.update(schema_1.users)
                    .set({
                    facebookId: fbUser.id,
                    photo: userByEmail[0].photo || fbPhotoUrl, // نحط صورة الفيس لو معندوش صورة
                    fcmToken: fcmToken || userByEmail[0].fcmToken
                })
                    .where((0, drizzle_orm_1.eq)(schema_1.users.id, userByEmail[0].id));
                userRecord = { ...userByEmail[0], facebookId: fbUser.id, photo: userByEmail[0].photo || fbPhotoUrl };
            }
        }
        // 4. لو اليوزر جديد تماماً (Signup)
        if (!userRecord) {
            await connection_1.db.insert(schema_1.users).values({
                name: fbUser.name,
                email: fbUser.email || null,
                facebookId: fbUser.id,
                photo: fbPhotoUrl,
                fcmToken: fcmToken || null,
                isVerified: true, // متوثق من الفيس بوك
                // phone & password will be null
            });
            // نجيب اليوزر بعد ما اتعمله Insert عشان محتاجين الـ ID بتاعه
            const newUser = await connection_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.facebookId, fbUser.id)).limit(1);
            userRecord = newUser[0];
        }
        // 5. إنشاء التوكن الخاص بالسيستم بتاعك
        const token = jsonwebtoken_1.default.sign({ id: userRecord.id }, process.env.JWT_SECRET || "fallback_secret_key", { expiresIn: "30d" });
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
    }
    catch (error) {
        console.error("Facebook Auth Error:", error.response?.data || error.message);
        return res.status(500).json({ success: false, message: "Internal server error during Facebook Auth" });
    }
};
exports.facebookLoginOrSignup = facebookLoginOrSignup;
