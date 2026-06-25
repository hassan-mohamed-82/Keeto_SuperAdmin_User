import { Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { users, restaurant_users } from "../models/schema";
import { db } from "../models/connection";
import { eq, or, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { nan } from "zod";

dotenv.config();

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export const verifyGoogleToken = async (req: Request, res: Response) => {
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

    const email = payload.email!;
    const name = payload.name || "Unknown User";
    const googleId = payload.sub;

    // 🔍 check if user exists by googleId OR email
    const existingUsers = await db
      .select()
      .from(users)
      .where(or(eq(users.googleId, googleId), eq(users.email, email)))
      .limit(1);

    let user = existingUsers[0];

    if (!user) {
      // ➕ Signup (new user)
      const newId = uuidv4();
      await db.insert(users).values({
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
        appleId:null
      };
    } else {
      // 👤 Login (existing user)
      // لو المستخدم كان موجود بالإيميل بس ومفيش googleId نخزنه
      if (!user.googleId) {
        await db.update(users).set({ googleId }).where(eq(users.id, user.id));
        user.googleId = googleId;
      }
    }

    // 🚫 Check if user is blocked
    if (user.status === "blocked") {
      return res.status(403).json({ success: false, message: "Your account has been blocked. Please contact support." });
    }

    // 🔗 Link to restaurant if restaurantId is provided
    if (restaurantId) {
      const existingLink = await db.select().from(restaurant_users)
        .where(and(eq(restaurant_users.restaurantId, restaurantId), eq(restaurant_users.userId, user.id)))
        .limit(1);
      if (existingLink.length === 0) {
        await db.insert(restaurant_users).values({ restaurantId, userId: user.id });
      }
    }

    // 🔑 Generate JWT (تم التعديل هنا ✅)
    const authToken = jwt.sign(
      { 
        id: user.id,
        name: user.name,
        role: "user", // أضفنا الرول لكي يمر من الـ Middleware
        type: "user", // أضفنا النوع لكي يخزنه الـ Middleware
        restaurantId: restaurantId || null // تمرير الـ restaurantId إذا وجد
      }, 
      process.env.JWT_SECRET!, 
      {
        expiresIn: "7d",
      }
    );

    return res.json({
      success: true,
      token: authToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Google login error:", error);
    res.status(401).json({ success: false, message: "Invalid token" });
  }
};