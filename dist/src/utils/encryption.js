"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.decryptSecret = exports.encryptSecret = void 0;
const crypto_1 = __importDefault(require("crypto"));
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const getEncryptionKey = () => {
    const secret = process.env.PAYMENT_CREDENTIALS_SECRET || process.env.JWT_SECRET || "keeto-default-payment-credentials-key-32b";
    return crypto_1.default.createHash("sha256").update(secret).digest();
};
const encryptSecret = (plainText) => {
    if (!plainText)
        return "";
    const key = getEncryptionKey();
    const iv = crypto_1.default.randomBytes(IV_LENGTH);
    const cipher = crypto_1.default.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plainText, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
};
exports.encryptSecret = encryptSecret;
const decryptSecret = (cipherText) => {
    if (!cipherText)
        return "";
    const parts = cipherText.split(":");
    if (parts.length !== 3) {
        return cipherText;
    }
    try {
        const [ivHex, authTagHex, encryptedHex] = parts;
        const key = getEncryptionKey();
        const iv = Buffer.from(ivHex, "hex");
        const authTag = Buffer.from(authTagHex, "hex");
        const decipher = crypto_1.default.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encryptedHex, "hex", "utf8");
        decrypted += decipher.final("utf8");
        return decrypted;
    }
    catch {
        return cipherText;
    }
};
exports.decryptSecret = decryptSecret;
