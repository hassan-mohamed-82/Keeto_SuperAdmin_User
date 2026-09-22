"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.facebookLoginOrSignup = void 0;
const axios_1 = __importDefault(require("axios"));
const drizzle_orm_1 = require("drizzle-orm");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const uuid_1 = require("uuid");
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const facebookLoginOrSignup = async (req, res) => {
    try {
        const { accessToken, restaurantId } = req.body;
        if (!accessToken) {
            return res.status(400).json({ success: false, message: "Access Token is required" });
        }
        // 1. جلب بيانات اليوزر من الفيس بوك Graph API
        const fbResponse = await axios_1.default.get(`https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${accessToken}`);
        const fbUser = fbResponse.data;
        const fbPhotoUrl = fbUser.picture?.data?.url || null;
        if (!fbUser || !fbUser.id) {
            return res.status(401).json({ success: false, message: "Invalid Facebook access token" });
        }
        // 2. البحث عن اليوزر بالـ Facebook ID
        const existingUser = await connection_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.facebookId, fbUser.id)).limit(1);
        let userRecord = existingUser[0];
        // 3. البحث بالإيميل لو غير موجود بـ Facebook ID
        if (!userRecord && fbUser.email) {
            const userByEmail = await connection_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.email, fbUser.email)).limit(1);
            if (userByEmail[0]) {
                // ✅ تحديث السجل في MySQL بدون .returning()
                await connection_1.db.update(schema_1.users)
                    .set({
                    facebookId: fbUser.id,
                    photo: userByEmail[0].photo || fbPhotoUrl,
                })
                    .where((0, drizzle_orm_1.eq)(schema_1.users.id, userByEmail[0].id));
                // جلب البيانات المحدثة
                const updatedUsers = await connection_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.id, userByEmail[0].id)).limit(1);
                userRecord = updatedUsers[0];
            }
        }
        // 4. إنشاء مستخدم جديد تماماً في حال عدم وجوده (Signup)
        if (!userRecord) {
            const newUserId = (0, uuid_1.v4)();
            // ✅ إضافة السجل في MySQL بدون .returning()
            await connection_1.db.insert(schema_1.users).values({
                id: newUserId,
                name: fbUser.name,
                email: fbUser.email || null,
                facebookId: fbUser.id,
                photo: fbPhotoUrl,
                isVerified: true,
                isProfileComplete: true,
            });
            // جلب المستخدم الجديد الذي تم إنشاؤه
            const newUsers = await connection_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.id, newUserId)).limit(1);
            userRecord = newUsers[0];
        }
        else if (!userRecord.isProfileComplete) {
            await connection_1.db.update(schema_1.users).set({ isProfileComplete: true }).where((0, drizzle_orm_1.eq)(schema_1.users.id, userRecord.id));
            userRecord.isProfileComplete = true;
        }
        // 5. فحص حالة الحساب (Blocked)
        if (userRecord.status === "blocked") {
            return res.status(403).json({ success: false, message: "Your account has been blocked. Please contact support." });
        }
        if (userRecord.deletedAt) {
            return res.status(403).json({ success: false, message: "Your account has been deleted. Please contact support." });
        }
        // 6. ربط المستخدم بالمطعم في حالة وجود restaurantId
        if (restaurantId) {
            const existingLink = await connection_1.db.select().from(schema_1.restaurant_users)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurant_users.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurant_users.userId, userRecord.id)))
                .limit(1);
            if (existingLink.length === 0) {
                await connection_1.db.insert(schema_1.restaurant_users).values({
                    id: (0, uuid_1.v4)(),
                    restaurantId,
                    userId: userRecord.id
                });
            }
        }
        // 7. توقيع الـ JWT Token
        const token = jsonwebtoken_1.default.sign({
            id: userRecord.id,
            name: userRecord.name,
            role: "user",
            type: "user",
            restaurantId: restaurantId || null
        }, process.env.JWT_SECRET || "fallback_secret_key", { expiresIn: "30d" });
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
    }
    catch (error) {
        console.error("Facebook Auth Error:", error.response?.data || error.message);
        return res.status(500).json({ success: false, message: "Internal server error during Facebook Auth" });
    }
};
exports.facebookLoginOrSignup = facebookLoginOrSignup;
