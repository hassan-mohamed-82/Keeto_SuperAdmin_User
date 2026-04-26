"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveBase64Image = saveBase64Image;
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const uuid_1 = require("uuid"); // لتوليد أسماء فريدة
async function saveBase64Image(req, base64, folder) {
    const matches = base64.match(/^data:(.+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
        throw new Error("Invalid base64 format");
    }
    const mimeType = matches[1];
    const ext = mimeType.split("/")[1] || "png";
    const buffer = Buffer.from(matches[2], "base64");
    // استخدام UUID لتجنب تكرار الأسماء
    const fileName = `${(0, uuid_1.v4)()}.${ext}`;
    const uploadsDir = path_1.default.join(__dirname, "../..", "uploads", folder);
    await promises_1.default.mkdir(uploadsDir, { recursive: true });
    const filePath = path_1.default.join(uploadsDir, fileName);
    await promises_1.default.writeFile(filePath, buffer);
    // إرجاع المسار النسبي والـ URL
    const relativePath = `uploads/${folder}/${fileName}`;
    const imageUrl = `${req.protocol}://${req.get("host")}/${relativePath}`;
    return { url: imageUrl, relativePath };
}
