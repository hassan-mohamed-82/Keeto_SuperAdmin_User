"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyGoogleToken = void 0;
const google_auth_library_1 = require("google-auth-library");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const dotenv_1 = __importDefault(require("dotenv"));
const schema_1 = require("../models/schema");
const connection_1 = require("../models/connection");
const drizzle_orm_1 = require("drizzle-orm");
const uuid_1 = require("uuid");
dotenv_1.default.config();
const client = new google_auth_library_1.OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const verifyGoogleToken = async (req, res) => {
    const { token, restaurantId } = req.body;
    try {
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        if (!payload) {
            return res
                .status(400)
                .json({ success: false, message: "Invalid Google payload" });
        }
        const email = payload.email;
        const name = payload.name || "Unknown User";
        const googleId = payload.sub;
        // 🔍 check if user exists by googleId OR email
        const existingUsers = await connection_1.db
            .select()
            .from(schema_1.users)
            .where((0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.users.googleId, googleId), (0, drizzle_orm_1.eq)(schema_1.users.email, email)))
            .limit(1);
        let user = existingUsers[0];
        let isNewUser = false;
        if (!user) {
            isNewUser = true;
            // ➕ Signup (new user)
            const newId = (0, uuid_1.v4)();
            await connection_1.db.insert(schema_1.users).values({
                id: newId,
                googleId,
                email,
                name,
                isVerified: true,
            });
            user = {
                id: newId,
                name,
                email,
                googleId,
                phone: null,
                photo: null,
                fcmToken: null,
                password: null,
                isVerified: true,
                status: "active",
                createdAt: new Date(),
                facebookId: null,
                appleId: null
            };
        }
        else {
            // 👤 Login (existing user)
            // لو المستخدم كان موجود بالإيميل بس ومفيش googleId نخزنه
            if (!user.googleId) {
                await connection_1.db.update(schema_1.users).set({ googleId }).where((0, drizzle_orm_1.eq)(schema_1.users.id, user.id));
                user.googleId = googleId;
            }
        }
        // 🚫 Check if user is blocked
        if (user.status === "blocked") {
            return res.status(403).json({ success: false, message: "Your account has been blocked. Please contact support." });
        }
        // 🔗 Link to restaurant if restaurantId is provided
        if (restaurantId && isNewUser) {
            const existingLink = await connection_1.db.select().from(schema_1.restaurant_users)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurant_users.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurant_users.userId, user.id)))
                .limit(1);
            if (existingLink.length === 0) {
                await connection_1.db.insert(schema_1.restaurant_users).values({ restaurantId, userId: user.id });
            }
        }
        // 🔑 Generate JWT (تم التعديل هنا ✅)
        const authToken = jsonwebtoken_1.default.sign({
            id: user.id,
            name: user.name,
            role: "user", // أضفنا الرول لكي يمر من الـ Middleware
            type: "user", // أضفنا النوع لكي يخزنه الـ Middleware
            restaurantId: restaurantId || null // تمرير الـ restaurantId إذا وجد
        }, process.env.JWT_SECRET, {
            expiresIn: "7d",
        });
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
        console.error("Google login error:", error);
        res.status(401).json({ success: false, message: "Invalid token" });
    }
};
exports.verifyGoogleToken = verifyGoogleToken;
