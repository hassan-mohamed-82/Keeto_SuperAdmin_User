import path from "path";
import fs from "fs/promises";
import { Request } from "express";
import { v4 as uuidv4 } from "uuid"; // لتوليد أسماء فريدة

export async function saveBase64Image(
  req: Request,
  base64: string,
  folder: string
): Promise<{ url: string; relativePath: string }> {
  const matches = base64.match(/^data:(.+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    throw new Error("Invalid base64 format");
  }

  const mimeType = matches[1];
  const ext = mimeType.split("/")[1] || "png";
  const buffer = Buffer.from(matches[2], "base64");

  // استخدام UUID لتجنب تكرار الأسماء
  const fileName = `${uuidv4()}.${ext}`;
  const uploadsDir = path.join(__dirname, "../..", "uploads", folder);

  await fs.mkdir(uploadsDir, { recursive: true });

  const filePath = path.join(uploadsDir, fileName);
  await fs.writeFile(filePath, buffer);

  // إرجاع المسار النسبي والـ URL
  const relativePath = `uploads/${folder}/${fileName}`;
  const imageUrl = `${req.protocol}://${req.get("host")}/${relativePath}`;

  return { url: imageUrl, relativePath };
}
