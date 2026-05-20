"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyGoogleToken = void 0;
const google_auth_library_1 = require("google-auth-library");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const dotenv_1 = __importDefault(require("dotenv"));
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema"); // تأكد من مسار الـ schema الصحيح عندك
const drizzle_orm_1 = require("drizzle-orm");
const uuid_1 = require("uuid");
dotenv_1.default.config();
const client = new google_auth_library_1.OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const verifyGoogleToken = async (req, res) => {
    const { token } = req.body;
    try {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        if (!clientId) {
            throw new Error("GOOGLE_CLIENT_ID is missing from environment variables");
        }
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: clientId,
        });
        const payload = ticket.getPayload();
        if (!payload) {
            return res
                .status(400)
                .json({ success: false, message: "Invalid Google payload" });
        }
        // استخراج بيانات المستخدم من جوجل
        const googleId = payload.sub;
        const email = payload.email || null;
        const name = payload.name || "Unknown User";
        const photo = payload.picture || null;
        // 🔍 البحث عن اليوزر بالـ googleId أو الإيميل
        const conditions = [(0, drizzle_orm_1.eq)(schema_1.users.googleId, googleId)];
        if (email) {
            conditions.push((0, drizzle_orm_1.eq)(schema_1.users.email, email));
        }
        const [existingUser] = await connection_1.db
            .select()
            .from(schema_1.users)
            .where((0, drizzle_orm_1.or)(...conditions))
            .limit(1);
        let userId;
        let userName = name;
        let userEmail = email;
        if (!existingUser) {
            // ➕ تسجيل مستخدم جديد (Signup)
            userId = (0, uuid_1.v4)();
            await connection_1.db.insert(schema_1.users).values({
                id: userId,
                email,
                name,
                photo,
                googleId,
                isVerified: true,
            });
        }
        else {
            // 👤 تسجيل دخول لمستخدم حالي (Login)
            userId = existingUser.id;
            userName = existingUser.name;
            userEmail = existingUser.email;
            // 🔄 ربط حساب جوجل بالحساب القديم لو مسجل بالإيميل قبل كده
            if (!existingUser.googleId) {
                await connection_1.db
                    .update(schema_1.users)
                    .set({ googleId, isVerified: true })
                    .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId));
            }
        }
        // 🔑 إنشاء الـ JWT وإضافة كل البيانات اللي الميدلوير بيحتاجها (id, role, name, type)
        const authToken = jsonwebtoken_1.default.sign({
            id: userId,
            role: "user",
            name: userName,
            type: "user"
        }, process.env.JWT_SECRET, {
            expiresIn: "7d",
        });
        return res.json({
            success: true,
            token: authToken,
            user: {
                id: userId,
                name: userName,
                email: userEmail,
                photo,
                role: "user",
                type: "user"
            },
        });
    }
    catch (error) {
        console.error("Google login error:", error);
        res.status(401).json({ success: false, message: "Invalid token or authentication failed" });
    }
};
exports.verifyGoogleToken = verifyGoogleToken;
