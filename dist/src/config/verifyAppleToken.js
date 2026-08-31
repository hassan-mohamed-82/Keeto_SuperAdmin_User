"use strict";
// import { Request, Response } from "express";
// import appleSignin from "apple-signin-auth";
// import jwt from "jsonwebtoken";
// import { users, restaurant_users } from "../models/schema";
// import { db } from "../models/connection";
// import { eq, or, and } from "drizzle-orm";
// import { v4 as uuidv4 } from "uuid";
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
    const { token, fullName } = req.body;
    let { restaurantId } = req.body;
    if (!token) {
        return res.status(400).json({ success: false, message: "Token is required" });
    }
    try {
        const allowedAudiences = [];
        // Always include the Web Client ID if configured
        if (process.env.APPLE_CLIENT_ID_WEB) {
            allowedAudiences.push(process.env.APPLE_CLIENT_ID_WEB);
        }
        // 1️⃣ Reverse Lookup: Decode token to find Bundle ID if restaurantId was not provided
        if (!restaurantId) {
            const decodedToken = jsonwebtoken_1.default.decode(token);
            // Extract audience string (aud can be string or array in JWT spec)
            const tokenAudience = Array.isArray(decodedToken?.aud)
                ? decodedToken?.aud[0]
                : decodedToken?.aud;
            if (tokenAudience) {
                // Find the restaurant matching this appBundleId
                const [foundRestaurant] = await connection_1.db
                    .select({ id: schema_1.restaurants.id, appBundleId: schema_1.restaurants.appBundleId })
                    .from(schema_1.restaurants)
                    .where((0, drizzle_orm_1.eq)(schema_1.restaurants.appBundleId, tokenAudience))
                    .limit(1);
                if (foundRestaurant) {
                    restaurantId = foundRestaurant.id;
                    if (foundRestaurant.appBundleId) {
                        allowedAudiences.push(foundRestaurant.appBundleId);
                    }
                }
            }
        }
        else {
            // 2️⃣ Fetch appBundleId directly if restaurantId was provided
            const [restaurant] = await connection_1.db
                .select({ appBundleId: schema_1.restaurants.appBundleId })
                .from(schema_1.restaurants)
                .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantId))
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
        const payload = await apple_signin_auth_1.default.verifyIdToken(token, {
            audience: allowedAudiences,
            ignoreExpiration: process.env.NODE_ENV !== "production",
        });
        const appleId = payload.sub; // Unique permanent Apple user ID
        const email = payload.email; // May be undefined after first login
        // 4️⃣ Search for existing user (Prioritize appleId to prevent duplicate/accidental accounts)
        let user = null;
        const usersByAppleId = await connection_1.db
            .select()
            .from(schema_1.users)
            .where((0, drizzle_orm_1.eq)(schema_1.users.appleId, appleId))
            .limit(1);
        user = usersByAppleId[0];
        // Fallback search by email if appleId not matched yet (for legacy accounts)
        if (!user && email) {
            const usersByEmail = await connection_1.db
                .select()
                .from(schema_1.users)
                .where((0, drizzle_orm_1.eq)(schema_1.users.email, email))
                .limit(1);
            user = usersByEmail[0];
            if (user) {
                await connection_1.db.update(schema_1.users).set({ appleId }).where((0, drizzle_orm_1.eq)(schema_1.users.id, user.id));
                user.appleId = appleId;
            }
        }
        // 5️⃣ Create user if not exists
        if (!user) {
            const finalEmail = email || `${appleId}@privaterelay.appleid.com`;
            const finalName = fullName || finalEmail.split("@")[0];
            const newId = (0, uuid_1.v4)();
            const isProfileComplete = !(finalEmail && finalEmail.endsWith("@privaterelay.appleid.com"));
            await connection_1.db.insert(schema_1.users).values({
                id: newId,
                appleId,
                email: finalEmail,
                name: finalName,
                isVerified: true,
                isProfileComplete,
            });
            user = {
                id: newId,
                name: finalName,
                email: finalEmail,
                appleId,
                isProfileComplete,
                status: "active",
            };
        }
        else {
            // If user exists and isProfileComplete was false but now email is real, update it
            const shouldBeComplete = !(user.email && user.email.endsWith("@privaterelay.appleid.com"));
            if (!user.isProfileComplete && shouldBeComplete) {
                await connection_1.db.update(schema_1.users).set({ isProfileComplete: true }).where((0, drizzle_orm_1.eq)(schema_1.users.id, user.id));
                user.isProfileComplete = true;
            }
        }
        // 6️⃣ Check account status
        if (user.status === "blocked") {
            return res.status(403).json({
                success: false,
                message: "Your account has been blocked. Please contact support."
            });
        }
        // 7️⃣ Link user to restaurant in multi-tenant table (Always checks if relation exists regardless of new/old user)
        if (restaurantId) {
            const existingLink = await connection_1.db
                .select()
                .from(schema_1.restaurant_users)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurant_users.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurant_users.userId, user.id)))
                .limit(1);
            if (existingLink.length === 0) {
                await connection_1.db.insert(schema_1.restaurant_users).values({
                    restaurantId,
                    userId: user.id
                });
            }
        }
        // 8️⃣ Generate JWT
        const authToken = jsonwebtoken_1.default.sign({
            id: user.id,
            name: user.name,
            role: "user",
            type: "user",
            restaurantId: restaurantId || null,
        }, process.env.JWT_SECRET, { expiresIn: "7d" });
        return res.json({
            success: true,
            token: authToken,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                isProfileComplete: user.isProfileComplete ?? !(user.email && user.email.endsWith("@privaterelay.appleid.com")),
            },
            restaurantId: restaurantId || null,
        });
    }
    catch (error) {
        console.error("Apple login error:", error);
        return res.status(401).json({ success: false, message: "Invalid Apple token" });
    }
};
exports.verifyAppleToken = verifyAppleToken;
