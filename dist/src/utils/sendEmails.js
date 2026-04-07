"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendStudentVerificationEmail = exports.verifyEmailVerificationToken = exports.generateEmailVerificationToken = exports.PASSWORD_RESET_CODE_TTL_MINUTES = exports.sendPasswordResetEmail = exports.consumePasswordResetCode = exports.verifyPasswordResetCode = exports.savePasswordResetCode = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const nodemailer_1 = __importDefault(require("nodemailer"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const resend_1 = require("resend");
const firebase_1 = require("./firebase");
const emailTemplate_1 = require("./emailTemplate");
const PASSWORD_RESET_COLLECTION = "password_reset_codes";
const PASSWORD_RESET_CODE_LENGTH = 6;
const PASSWORD_RESET_LIFETIME_MINUTES = 5;
const EMAIL_VERIFICATION_LIFETIME_HOURS = 1;
const EMAIL_VERIFICATION_SECRET = process.env.EMAIL_VERIFICATION_SECRET || process.env.JWT_SECRET || "";
const getEmailDocumentId = (email) => Buffer.from(email.toLowerCase()).toString("base64url");
const generateNumericCode = (length = PASSWORD_RESET_CODE_LENGTH) => {
    let code = "";
    for (let index = 0; index < length; index += 1) {
        code += Math.floor(Math.random() * 10).toString();
    }
    return code;
};
const getFromEmail = () => process.env.EMAIL_FROM || process.env.SMTP_FROM || "no-reply@mathhouse.app";
const getResendClient = () => {
    if (!process.env.RESEND_API_KEY) {
        return null;
    }
    return new resend_1.Resend(process.env.RESEND_API_KEY);
};
const getSmtpTransporter = () => {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
        return null;
    }
    return nodemailer_1.default.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT),
        secure: Number(SMTP_PORT) === 465,
        auth: {
            user: SMTP_USER,
            pass: SMTP_PASS,
        },
    });
};
const sendEmail = async ({ to, subject, html, }) => {
    const resend = getResendClient();
    if (resend) {
        await resend.emails.send({
            from: getFromEmail(),
            to,
            subject,
            html,
        });
        return;
    }
    const transporter = getSmtpTransporter();
    if (transporter) {
        await transporter.sendMail({
            from: getFromEmail(),
            to,
            subject,
            html,
        });
        return;
    }
    throw new Error("No email provider configured. Set RESEND_API_KEY or SMTP credentials.");
};
const savePasswordResetCode = async (email, code, expiresAt) => {
    const codeHash = await bcrypt_1.default.hash(code, 10);
    const docId = getEmailDocumentId(email);
    const payload = {
        email: email.toLowerCase(),
        codeHash,
        expiresAt: expiresAt.toISOString(),
        createdAt: new Date().toISOString(),
        used: false,
    };
    await firebase_1.firestore.collection(PASSWORD_RESET_COLLECTION).doc(docId).set(payload);
};
exports.savePasswordResetCode = savePasswordResetCode;
const verifyPasswordResetCode = async (email, code) => {
    const docId = getEmailDocumentId(email);
    const snapshot = await firebase_1.firestore.collection(PASSWORD_RESET_COLLECTION).doc(docId).get();
    if (!snapshot.exists) {
        return false;
    }
    const data = snapshot.data();
    if (data.used) {
        return false;
    }
    if (new Date(data.expiresAt).getTime() < Date.now()) {
        return false;
    }
    return bcrypt_1.default.compare(code, data.codeHash);
};
exports.verifyPasswordResetCode = verifyPasswordResetCode;
const consumePasswordResetCode = async (email) => {
    const docId = getEmailDocumentId(email);
    await firebase_1.firestore.collection(PASSWORD_RESET_COLLECTION).doc(docId).set({
        used: true,
    }, { merge: true });
};
exports.consumePasswordResetCode = consumePasswordResetCode;
const sendPasswordResetEmail = async (email, name = "there") => {
    const code = generateNumericCode(PASSWORD_RESET_CODE_LENGTH);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_LIFETIME_MINUTES * 60 * 1000);
    await (0, exports.savePasswordResetCode)(email, code, expiresAt);
    await sendEmail({
        to: email,
        subject: "Password Reset Code",
        html: (0, emailTemplate_1.passwordResetTemplate)(name, code, `${PASSWORD_RESET_LIFETIME_MINUTES} minutes`),
    });
    return {
        email,
        expiresAt,
        lifetimeMinutes: PASSWORD_RESET_LIFETIME_MINUTES,
    };
};
exports.sendPasswordResetEmail = sendPasswordResetEmail;
exports.PASSWORD_RESET_CODE_TTL_MINUTES = PASSWORD_RESET_LIFETIME_MINUTES;
const generateEmailVerificationToken = (studentId, email) => {
    if (!EMAIL_VERIFICATION_SECRET) {
        throw new Error("Missing EMAIL_VERIFICATION_SECRET or JWT_SECRET for email verification.");
    }
    return jsonwebtoken_1.default.sign({
        studentId,
        email,
        purpose: "student-email-verification",
    }, EMAIL_VERIFICATION_SECRET, { expiresIn: `${EMAIL_VERIFICATION_LIFETIME_HOURS}h` });
};
exports.generateEmailVerificationToken = generateEmailVerificationToken;
const verifyEmailVerificationToken = (token) => {
    if (!EMAIL_VERIFICATION_SECRET) {
        throw new Error("Missing EMAIL_VERIFICATION_SECRET or JWT_SECRET for email verification.");
    }
    return jsonwebtoken_1.default.verify(token, EMAIL_VERIFICATION_SECRET);
};
exports.verifyEmailVerificationToken = verifyEmailVerificationToken;
const sendStudentVerificationEmail = async (params) => {
    const token = (0, exports.generateEmailVerificationToken)(params.studentId, params.email);
    const publicAppUrl = (process.env.PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
    const verificationUrl = `${publicAppUrl}/api/user/auth/verify-email?token=${encodeURIComponent(token)}`;
    await sendEmail({
        to: params.email,
        subject: "Verify your Maths House email",
        html: (0, emailTemplate_1.emailVerificationLinkTemplate)(params.name, verificationUrl, `${EMAIL_VERIFICATION_LIFETIME_HOURS} hour`),
    });
    return {
        token,
        verificationUrl,
        expiresInHours: EMAIL_VERIFICATION_LIFETIME_HOURS,
    };
};
exports.sendStudentVerificationEmail = sendStudentVerificationEmail;
