"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetPassword = exports.verifyResetCode = exports.forgotPassword = exports.login = exports.verifyEmail = exports.signup = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const bcrypt_1 = __importDefault(require("bcrypt"));
const uuid_1 = require("uuid");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const jwt_1 = require("../../utils/jwt");
const sendEmails_1 = require("../../utils/sendEmails");
const verifyEmailPages_1 = require("../../utils/verifyEmailPages");
const generateOTP = (length = 6) => {
    let otp = "";
    for (let i = 0; i < length; i++) {
        otp += Math.floor(Math.random() * 10).toString();
    }
    return otp;
};
// ===================================
// 1. Signup
// ===================================
const signup = async (req, res) => {
    const { name, email, phone, password, photo, restaurantId } = req.body;
    if (!name || !email || !phone || !password) {
        throw new BadRequest_1.BadRequest("Please provide all required fields");
    }
    const [existingUser] = await connection_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.email, email)).limit(1);
    const hashedPassword = await bcrypt_1.default.hash(password, 10);
    // 🔥 always use same userId logic
    const userId = existingUser ? existingUser.id : (0, uuid_1.v4)();
    // استدعاء الرابط من البيئة، وإذا لم يوجد نستخدم لوكال هوست كاحتياط
    const baseUrl = process.env.BASE_URL || "http://localhost:3000";
    const token = (0, uuid_1.v4)();
    // ✅ الآن الرابط سيتغير تلقائياً بناءً على مكان تشغيل الكود
    const verifyLink = `${baseUrl}/api/user/auth/verify-email?token=${token}`;
    await connection_1.db.transaction(async (tx) => {
        if (existingUser) {
            if (existingUser.isVerified) {
                throw new BadRequest_1.BadRequest("Email is already registered");
            }
            await tx.update(schema_1.users).set({
                name,
                phone,
                password: hashedPassword,
                photo,
            }).where((0, drizzle_orm_1.eq)(schema_1.users.id, userId));
            // delete old tokens
            await tx.delete(schema_1.emailVerifications).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.emailVerifications.userId, userId), (0, drizzle_orm_1.eq)(schema_1.emailVerifications.purpose, "verify_email")));
        }
        else {
            await tx.insert(schema_1.users).values({
                id: userId,
                name,
                email,
                phone,
                password: hashedPassword,
                photo,
                isVerified: false
            });
        }
        if (restaurantId) {
            const [existingLink] = await tx.select().from(schema_1.restaurant_users)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurant_users.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurant_users.userId, userId)))
                .limit(1);
            if (!existingLink) {
                await tx.insert(schema_1.restaurant_users).values({ restaurantId, userId });
            }
        }
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
        await tx.insert(schema_1.emailVerifications).values({
            id: (0, uuid_1.v4)(),
            userId,
            code: token,
            purpose: "verify_email",
            expiresAt
        });
        await (0, sendEmails_1.sendEmail)({
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
    const isProfileComplete = !(email && email.endsWith("@privaterelay.appleid.com"));
    return (0, response_1.SuccessResponse)(res, {
        message: "Account created successfully. Please check your email.",
        data: {
            isProfileComplete
        }
    }, 201);
};
exports.signup = signup;
// ===================================
// 2. Verify Email
// ===================================
const verifyEmail = async (req, res) => {
    const { token } = req.query;
    // إنشاء نصوص HTML المنسقة باستخدام الدالة المساعدة
    const successHTML = (0, verifyEmailPages_1.getVerifyEmailPage)("success");
    const errorHTML = (0, verifyEmailPages_1.getVerifyEmailPage)("error");
    if (!token) {
        return res.status(400).send(errorHTML);
    }
    try {
        const [record] = await connection_1.db.select().from(schema_1.emailVerifications)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.emailVerifications.code, String(token)), (0, drizzle_orm_1.eq)(schema_1.emailVerifications.purpose, "verify_email")))
            .limit(1);
        if (!record) {
            return res.status(400).send(errorHTML);
        }
        if (new Date() > new Date(record.expiresAt)) {
            return res.status(400).send(errorHTML);
        }
        await connection_1.db.transaction(async (tx) => {
            await tx.update(schema_1.users)
                .set({ isVerified: true })
                .where((0, drizzle_orm_1.eq)(schema_1.users.id, record.userId));
            await tx.delete(schema_1.emailVerifications)
                .where((0, drizzle_orm_1.eq)(schema_1.emailVerifications.id, record.id));
        });
        // إرسال صفحة النجاح بتصميمها الجديد!
        return res.send(successHTML);
    }
    catch (error) {
        console.error("Verification Error:", error);
        // إذا فشلت قاعدة البيانات، أرسل واجهة الخطأ بدلاً من توقف التطبيق عن العمل
        return res.status(500).send(errorHTML);
    }
};
exports.verifyEmail = verifyEmail;
// ===================================
// 3. Login
// ===================================
const login = async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        throw new BadRequest_1.BadRequest("Email and password are required");
    const [user] = await connection_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.email, email)).limit(1);
    if (!user)
        throw new BadRequest_1.BadRequest("Invalid credentials");
    if (!user.isVerified) {
        // ممكن نعيد إرسال الكود هنا لو أردت
        throw new BadRequest_1.BadRequest("Please verify your email before logging in");
    }
    const isMatch = await bcrypt_1.default.compare(password, user.password);
    if (!isMatch)
        throw new BadRequest_1.BadRequest("Invalid credentials");
    if (user.status === "blocked") {
        throw new BadRequest_1.BadRequest("Your account has been blocked. Please contact support.");
    }
    const token = (0, jwt_1.generateUserToken)({ id: user.id, name: user.name });
    const isProfileComplete = !(user.email && user.email.endsWith("@privaterelay.appleid.com"));
    return (0, response_1.SuccessResponse)(res, { message: "Login successful", data: { token, user: { id: user.id, name: user.name, email: user.email, isProfileComplete } } });
};
exports.login = login;
// ===================================
// 4. Forgot Password
// ===================================
const forgotPassword = async (req, res) => {
    const { email } = req.body;
    if (!email)
        throw new BadRequest_1.BadRequest("Email is required");
    const [user] = await connection_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.email, email)).limit(1);
    if (!user) {
        return (0, response_1.SuccessResponse)(res, { message: "If this email is registered, a password reset code has been sent." });
    }
    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // صالح لمدة 15 دقيقة
    await connection_1.db.transaction(async (tx) => {
        // مسح أي كود قديم للريست
        await tx.delete(schema_1.emailVerifications).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.emailVerifications.userId, user.id), (0, drizzle_orm_1.eq)(schema_1.emailVerifications.purpose, "reset_password")));
        await tx.insert(schema_1.emailVerifications).values({
            id: (0, uuid_1.v4)(),
            userId: user.id,
            code,
            purpose: "reset_password",
            expiresAt
        });
    });
    await (0, sendEmails_1.sendEmail)({
        to: email,
        subject: "Password Reset Code (Keeto)",
        html: `<h1>Hello ${user.name}</h1><p>Your password reset code is: <b>${code}</b></p><p>It will expire in 15 minutes.</p>`
    });
    return (0, response_1.SuccessResponse)(res, { message: "If this email is registered, a password reset code has been sent." });
};
exports.forgotPassword = forgotPassword;
// ===================================
// 5. Verify Reset Code
// ===================================
const verifyResetCode = async (req, res) => {
    const { email, code } = req.body;
    if (!email || !code)
        throw new BadRequest_1.BadRequest("Email and code are required");
    const [user] = await connection_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.email, email)).limit(1);
    if (!user)
        throw new BadRequest_1.BadRequest("Invalid request");
    const [record] = await connection_1.db.select().from(schema_1.emailVerifications).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.emailVerifications.userId, user.id), (0, drizzle_orm_1.eq)(schema_1.emailVerifications.code, code), (0, drizzle_orm_1.eq)(schema_1.emailVerifications.purpose, "reset_password"))).limit(1);
    if (!record)
        throw new BadRequest_1.BadRequest("Invalid code");
    if (new Date() > new Date(record.expiresAt))
        throw new BadRequest_1.BadRequest("Code has expired");
    return (0, response_1.SuccessResponse)(res, { message: "Code verified. You can now reset your password." });
};
exports.verifyResetCode = verifyResetCode;
// ===================================
// 6. Reset Password
// ===================================
const resetPassword = async (req, res) => {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword)
        throw new BadRequest_1.BadRequest("Email, code, and new password are required");
    const [user] = await connection_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.email, email)).limit(1);
    if (!user)
        throw new BadRequest_1.BadRequest("Invalid request");
    const [record] = await connection_1.db.select().from(schema_1.emailVerifications).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.emailVerifications.userId, user.id), (0, drizzle_orm_1.eq)(schema_1.emailVerifications.code, code), (0, drizzle_orm_1.eq)(schema_1.emailVerifications.purpose, "reset_password"))).limit(1);
    if (!record)
        throw new BadRequest_1.BadRequest("Invalid code");
    if (new Date() > new Date(record.expiresAt))
        throw new BadRequest_1.BadRequest("Code has expired");
    const salt = await bcrypt_1.default.genSalt(10);
    const hashedPassword = await bcrypt_1.default.hash(newPassword, salt);
    await connection_1.db.transaction(async (tx) => {
        await tx.update(schema_1.users).set({ password: hashedPassword }).where((0, drizzle_orm_1.eq)(schema_1.users.id, user.id));
        await tx.delete(schema_1.emailVerifications).where((0, drizzle_orm_1.eq)(schema_1.emailVerifications.id, record.id));
    });
    return (0, response_1.SuccessResponse)(res, { message: "Password has been reset successfully. You can now login." });
};
exports.resetPassword = resetPassword;
