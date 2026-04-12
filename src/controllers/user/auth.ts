import { Request, Response } from "express";
import { db } from "../../models/connection";
import { users, emailVerifications } from "../../models/schema";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { generateUserToken } from "../../utils/jwt";
import { sendEmail } from "../../utils/sendEmails";
import { getVerifyEmailPage } from "../../utils/verifyEmailPages";

const generateOTP = (length: number = 6): string => {
    let otp = "";
    for (let i = 0; i < length; i++) {
        otp += Math.floor(Math.random() * 10).toString();
    }
    return otp;
};

// ===================================
// 1. Signup
// ===================================
export const signup = async (req: Request, res: Response) => {
    const { name, email, phone, password, countryId, cityId, zoneId, address ,photo} = req.body;

    if (!name || !email || !phone || !password || !countryId || !cityId || !zoneId) {
        throw new BadRequest("Please provide all required fields");
    }

    const [existingUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    const hashedPassword = await bcrypt.hash(password, 10);

    // 🔥 always use same userId logic
    const userId = existingUser ? existingUser.id : uuidv4();

   // استدعاء الرابط من البيئة، وإذا لم يوجد نستخدم لوكال هوست كاحتياط
const baseUrl = process.env.BASE_URL || "http://localhost:3000";

const token = uuidv4();

// ✅ الآن الرابط سيتغير تلقائياً بناءً على مكان تشغيل الكود
const verifyLink = `${baseUrl}/api/user/auth/verify-email?token=${token}`;
    await db.transaction(async (tx) => {

        if (existingUser) {
            if (existingUser.isVerified) {
                throw new BadRequest("Email is already registered");
            }

            await tx.update(users).set({
                name,
                phone,
                password: hashedPassword,
                countryId,
                cityId,
                photo,
                zoneId,
                address
            }).where(eq(users.id, userId));

            // delete old tokens
            await tx.delete(emailVerifications).where(
                and(
                    eq(emailVerifications.userId, userId),
                    eq(emailVerifications.purpose, "verify_email")
                )
            );

        } else {
            await tx.insert(users).values({
                id: userId,
                name,
                email,
                phone,
                password: hashedPassword,
                countryId,
                cityId,
                zoneId,
                address,
                isVerified: false
            });
        }

        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

        await tx.insert(emailVerifications).values({
            id: uuidv4(),
            userId,
            code: token,
            purpose: "verify_email",
            expiresAt
        });

        await sendEmail({
            to: email,
            subject: "Verify Your Keeto Account",
            html: `
<!DOCTYPE html>
<html>
<body style="margin:0; padding:0; background:#f4f6f8; font-family:Arial;">

  <table width="100%" style="padding:20px;">
    <tr>
      <td align="center">

        <table width="420" style="background:#fff; padding:30px; border-radius:12px;">

          <tr>
            <td align="center">
              <h1 style="color:#ff6b00;">🍔 Keeto</h1>
            </td>
          </tr>

          <tr>
            <td align="center">
              <h2 style="color:#333;">Verify Your Email</h2>
              <p style="color:#666;">Hi <b>${name}</b>, click below to activate your account.</p>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:25px;">
              <a href="${verifyLink}" style="
                background:#ff6b00;
                color:#fff;
                padding:14px 24px;
                text-decoration:none;
                border-radius:8px;
                font-weight:bold;
                display:inline-block;
              ">
                ✅ Verify Account
              </a>
            </td>
          </tr>

          <tr>
            <td align="center">
              <p style="font-size:12px; color:#999;">
                Or copy link:<br/>
                <a href="${verifyLink}" style="color:#ff6b00;">${verifyLink}</a>
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>
            `
        });
    });

    return SuccessResponse(res, {
        message: "Account created successfully. Please check your email."
    }, 201);
};
// ===================================
// 2. Verify Email
// ===================================
export const verifyEmail = async (req: Request, res: Response) => {
    const { token } = req.query;

    // إنشاء نصوص HTML المنسقة باستخدام الدالة المساعدة
    const successHTML = getVerifyEmailPage("success");
    const errorHTML = getVerifyEmailPage("error");

    if (!token) {
        return res.status(400).send(errorHTML);
    }

    try {
        const [record] = await db.select().from(emailVerifications)
            .where(
                and(
                    eq(emailVerifications.code, String(token)),
                    eq(emailVerifications.purpose, "verify_email")
                )
            )
            .limit(1);

        if (!record) {
            return res.status(400).send(errorHTML);
        }

        if (new Date() > new Date(record.expiresAt)) {
            return res.status(400).send(errorHTML);
        }

        await db.transaction(async (tx) => {
            await tx.update(users)
                .set({ isVerified: true })
                .where(eq(users.id, record.userId));

            await tx.delete(emailVerifications)
                .where(eq(emailVerifications.id, record.id));
        });

        // إرسال صفحة النجاح بتصميمها الجديد!
        return res.send(successHTML);
        
    } catch (error) {
        console.error("Verification Error:", error);
        // إذا فشلت قاعدة البيانات، أرسل واجهة الخطأ بدلاً من توقف التطبيق عن العمل
        return res.status(500).send(errorHTML); 
    }
};
// ===================================
// 3. Login
// ===================================
export const login = async (req: Request, res: Response) => {
    const { email, password } = req.body;

    if (!email || !password) throw new BadRequest("Email and password are required");

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user) throw new BadRequest("Invalid credentials");

    if (!user.isVerified) {
        // ممكن نعيد إرسال الكود هنا لو أردت
        throw new BadRequest("Please verify your email before logging in");
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw new BadRequest("Invalid credentials");

    const token = generateUserToken({ id: user.id, name: user.name, email: user.email });

    return SuccessResponse(res, { message: "Login successful", data: { token, user: { id: user.id, name: user.name, email: user.email } } });
};

// ===================================
// 4. Forgot Password
// ===================================
export const forgotPassword = async (req: Request, res: Response) => {
    const { email } = req.body;
    if (!email) throw new BadRequest("Email is required");

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user) {
        return SuccessResponse(res, { message: "If this email is registered, a password reset code has been sent." });
    }

    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // صالح لمدة 15 دقيقة

    await db.transaction(async (tx) => {
        // مسح أي كود قديم للريست
        await tx.delete(emailVerifications).where(
            and(eq(emailVerifications.userId, user.id), eq(emailVerifications.purpose, "reset_password"))
        );

        await tx.insert(emailVerifications).values({
            id: uuidv4(),
            userId: user.id,
            code,
            purpose: "reset_password",
            expiresAt
        });
    });

    await sendEmail({
        to: email,
        subject: "Password Reset Code (Keeto)",
        html: `<h1>Hello ${user.name}</h1><p>Your password reset code is: <b>${code}</b></p><p>It will expire in 15 minutes.</p>`
    });

    return SuccessResponse(res, { message: "If this email is registered, a password reset code has been sent." });
};

// ===================================
// 5. Verify Reset Code
// ===================================
export const verifyResetCode = async (req: Request, res: Response) => {
    const { email, code } = req.body;
    if (!email || !code) throw new BadRequest("Email and code are required");

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user) throw new BadRequest("Invalid request");

    const [record] = await db.select().from(emailVerifications).where(
        and(eq(emailVerifications.userId, user.id), eq(emailVerifications.code, code), eq(emailVerifications.purpose, "reset_password"))
    ).limit(1);

    if (!record) throw new BadRequest("Invalid code");
    if (new Date() > new Date(record.expiresAt)) throw new BadRequest("Code has expired");

    return SuccessResponse(res, { message: "Code verified. You can now reset your password." });
};

// ===================================
// 6. Reset Password
// ===================================
export const resetPassword = async (req: Request, res: Response) => {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) throw new BadRequest("Email, code, and new password are required");

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user) throw new BadRequest("Invalid request");

    const [record] = await db.select().from(emailVerifications).where(
        and(eq(emailVerifications.userId, user.id), eq(emailVerifications.code, code), eq(emailVerifications.purpose, "reset_password"))
    ).limit(1);

    if (!record) throw new BadRequest("Invalid code");
    if (new Date() > new Date(record.expiresAt)) throw new BadRequest("Code has expired");

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await db.transaction(async (tx) => {
        await tx.update(users).set({ password: hashedPassword }).where(eq(users.id, user.id));
        await tx.delete(emailVerifications).where(eq(emailVerifications.id, record.id));
    });

    return SuccessResponse(res, { message: "Password has been reset successfully. You can now login." });
};
