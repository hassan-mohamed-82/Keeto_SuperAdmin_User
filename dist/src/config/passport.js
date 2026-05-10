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
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const uuid_1 = require("uuid");
const bcrypt_1 = __importDefault(require("bcrypt"));
dotenv_1.default.config();
const client = new google_auth_library_1.OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const verifyGoogleToken = async (req, res) => {
    const { token } = req.body;
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
        const photo = payload.picture || null;
        // 🔍 check if user exists by email
        const [existingUser] = await connection_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.email, email)).limit(1);
        let userId;
        let userName = name;
        let userEmail = email;
        if (!existingUser) {
            // ➕ Signup (new user)
            userId = (0, uuid_1.v4)();
            const randomPassword = await bcrypt_1.default.hash((0, uuid_1.v4)(), 10);
            await connection_1.db.insert(schema_1.users).values({
                id: userId,
                email,
                name,
                photo,
                password: randomPassword,
                phone: "0000000000", // Fallback required field
                isVerified: true,
            });
        }
        else {
            // 👤 Login (existing user)
            userId = existingUser.id;
            userName = existingUser.name;
            userEmail = existingUser.email;
        }
        // 🔑 Generate JWT
        const authToken = jsonwebtoken_1.default.sign({ id: userId }, process.env.JWT_SECRET, {
            expiresIn: "7d",
        });
        return res.json({
            success: true,
            token: authToken,
            user: {
                id: userId,
                name: userName,
                email: userEmail,
            },
        });
    }
    catch (error) {
        console.error("Google login error:", error);
        res.status(401).json({ success: false, message: "Invalid token" });
    }
};
exports.verifyGoogleToken = verifyGoogleToken;
