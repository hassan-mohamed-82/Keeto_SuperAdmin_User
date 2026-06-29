"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyAppleToken = void 0;
const apple_signin_auth_1 = __importDefault(require("apple-signin-auth"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const schema_1 = require("../models/schema");
const connection_1 = require("../models/connection");
const drizzle_orm_1 = require("drizzle-orm");
const uuid_1 = require("uuid");
const verifyAppleToken = async (req, res) => {
    // الـ Frontend (سواء الموبايل أو الويب) سيرسل الـ token.
    // ملاحظة: أبل ترسل الاسم الكامل أول مرة فقط، لذا يجب على الـ Frontend تمرير fullName كخيار إضافي.
    const { token, restaurantId, fullName } = req.body;
    if (!token) {
        return res.status(400).json({ success: false, message: "Token is required" });
    }
    try {
        // 1️⃣ التحقق من صحة الـ Token مع سيرفرات أبل
        const payload = await apple_signin_auth_1.default.verifyIdToken(token, {
            // نقبل الطلبات القادمة من تطبيق الـ iOS أو موقع الـ Web
            audience: [
                process.env.APPLE_CLIENT_ID_IOS,
                process.env.APPLE_CLIENT_ID_WEB
            ],
            ignoreExpiration: true, // يفضل تفعيلها في بيئة التطوير لتجنب مشاكل الوقت
        });
        const email = payload.email;
        const appleId = payload.sub; // المعرف الفريد للمستخدم في أبل
        // 2️⃣ البحث عن المستخدم في قاعدة البيانات عبر Drizzle
        const existingUsers = await connection_1.db
            .select()
            .from(schema_1.users)
            .where((0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.users.appleId, appleId), (0, drizzle_orm_1.eq)(schema_1.users.email, email)))
            .limit(1);
        let user = existingUsers[0];
        let isNewUser = false;
        // 3️⃣ إنشاء مستخدم جديد إذا لم يكن موجوداً
        if (!user) {
            isNewUser = true;
            const newId = (0, uuid_1.v4)();
            // إذا لم يرسل الـ Frontend اسماً، نستخدم أول جزء من الإيميل كحل بديل
            const finalName = fullName || email.split("@")[0];
            await connection_1.db.insert(schema_1.users).values({
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
            };
        }
        else {
            // 4️⃣ إذا كان المستخدم مسجلاً (مثلاً عبر جوجل) وليس لديه appleId، نقوم بربط حسابه
            if (!user.appleId) {
                await connection_1.db.update(schema_1.users).set({ appleId }).where((0, drizzle_orm_1.eq)(schema_1.users.id, user.id));
                user.appleId = appleId;
            }
        }
        // 5️⃣ التأكد من أن الحساب غير محظور
        if (user.status === "blocked") {
            return res.status(403).json({ success: false, message: "Your account has been blocked. Please contact support." });
        }
        // 6️⃣ ربط المستخدم بالمطعم في نظام الـ Multi-tenant
        if (restaurantId && isNewUser) {
            const existingLink = await connection_1.db.select().from(schema_1.restaurant_users)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurant_users.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurant_users.userId, user.id)))
                .limit(1);
            if (existingLink.length === 0) {
                await connection_1.db.insert(schema_1.restaurant_users).values({ restaurantId, userId: user.id });
            }
        }
        // 7️⃣ توليد الـ JWT
        const authToken = jsonwebtoken_1.default.sign({
            id: user.id,
            name: user.name,
            role: "user",
            type: "user",
            restaurantId: restaurantId || null
        }, process.env.JWT_SECRET, { expiresIn: "7d" });
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
    }
    catch (error) {
        console.error("Apple login error:", error);
        res.status(401).json({ success: false, message: "Invalid Apple token" });
    }
};
exports.verifyAppleToken = verifyAppleToken;
