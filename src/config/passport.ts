import { Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { db } from "../models/connection";
import { users } from "../models/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcrypt";

dotenv.config();

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export const verifyGoogleToken = async (req: Request, res: Response) => {
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

    const email = payload.email!;
    const name = payload.name || "Unknown User";
    const photo = payload.picture || null;

    // 🔍 check if user exists by email
    const [existingUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    let userId: string;
    let userName: string | null = name;
    let userEmail: string | null = email;

    if (!existingUser) {
      // ➕ Signup (new user)
      userId = uuidv4();
      const randomPassword = await bcrypt.hash(uuidv4(), 10);
      
      await db.insert(users).values({
        id: userId,
        email,
        name,
        photo,
        password: randomPassword,
        phone: "0000000000", // Fallback required field
        isVerified: true,
      });
    } else {
      // 👤 Login (existing user)
      userId = existingUser.id;
      userName = existingUser.name;
      userEmail = existingUser.email;
    }

    // 🔑 Generate JWT
    const authToken = jwt.sign({ id: userId }, process.env.JWT_SECRET!, {
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
  } catch (error) {
    console.error("Google login error:", error);
    res.status(401).json({ success: false, message: "Invalid token" });
  }
};
