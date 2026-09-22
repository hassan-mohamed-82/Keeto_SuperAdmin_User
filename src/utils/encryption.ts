import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

const getEncryptionKey = (): Buffer => {
    const secret = process.env.PAYMENT_CREDENTIALS_SECRET || process.env.JWT_SECRET || "keeto-default-payment-credentials-key-32b";
    return crypto.createHash("sha256").update(secret).digest();
};

export const encryptSecret = (plainText: string): string => {
    if (!plainText) return "";
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plainText, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
};

export const decryptSecret = (cipherText: string): string => {
    if (!cipherText) return "";
    const parts = cipherText.split(":");
    if (parts.length !== 3) {
        return cipherText;
    }
    try {
        const [ivHex, authTagHex, encryptedHex] = parts;
        const key = getEncryptionKey();
        const iv = Buffer.from(ivHex, "hex");
        const authTag = Buffer.from(authTagHex, "hex");
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encryptedHex, "hex", "utf8");
        decrypted += decipher.final("utf8");
        return decrypted;
    } catch {
        return cipherText;
    }
};
