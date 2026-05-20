import { Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { db } from "../models/connection";
import { users } from "../models/schema"; // تأكد من مسار الـ schema الصحيح عندك
import { eq, or } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

dotenv.config();

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export const verifyGoogleToken = async (req: Request, res: Response) => {
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
    const conditions = [eq(users.googleId, googleId)];
    if (email) {
      conditions.push(eq(users.email, email));
    }

    const [existingUser] = await db
      .select()
      .from(users)
      .where(or(...conditions))
      .limit(1);

    let userId: string;
    let userName: string | null = name;
    let userEmail: string | null = email;

    if (!existingUser) {
      // ➕ تسجيل مستخدم جديد (Signup)
      userId = uuidv4();
      
      await db.insert(users).values({
        id: userId,
        email,
        name,
        photo,
        googleId, 
        isVerified: true, 
      });
    } else {
      // 👤 تسجيل دخول لمستخدم حالي (Login)
      userId = existingUser.id;
      userName = existingUser.name;
      userEmail = existingUser.email;

      // 🔄 ربط حساب جوجل بالحساب القديم لو مسجل بالإيميل قبل كده
      if (!existingUser.googleId) {
        await db
          .update(users)
          .set({ googleId, isVerified: true })
          .where(eq(users.id, userId));
      }
    }

    // 🔑 إنشاء الـ JWT وإضافة كل البيانات اللي الميدلوير بيحتاجها (id, role, name, type)
    const authToken = jwt.sign(
      { 
        id: userId,
        role: "user",
        name: userName,
        type: "user"
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
        id: userId,
        name: userName,
        email: userEmail,
        photo,
        role: "user",
        type: "user"
      },
    });
  } catch (error) {
    console.error("Google login error:", error);
    res.status(401).json({ success: false, message: "Invalid token or authentication failed" });
  }
};