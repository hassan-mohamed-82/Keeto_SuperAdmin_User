import path from "path";
import fs from "fs/promises";
import { Request } from "express";
import { v4 as uuidv4 } from "uuid";
import { BadRequest } from "../Errors";

const normalizeImagePayload = (img: any): string | undefined => {
  if (!img) return undefined;
  if (typeof img === 'string') {
      if (img.trim() === '') return undefined;
      return img;
  }
  
  try {
      const str = JSON.stringify(img);
      const base64Match = str.match(/(data:image\/[a-zA-Z0-9+.-]+;base64,[^"'\\]+)/);
      if (base64Match) return base64Match[1];
      
      const urlMatch = str.match(/(https?:\/\/[^"'\\]+)/);
      if (urlMatch) return urlMatch[1];
  } catch (e) {}
  
  return undefined;
};

export async function saveBase64Image(
  req: Request,
  base64: any,
  folder: string
): Promise<{ url: string; relativePath: string }> {
  
  const normalizedBase64 = normalizeImagePayload(base64);

  if (!normalizedBase64) {
    return { url: "", relativePath: "" };
  }

  if (normalizedBase64.startsWith("http")) {
    return { url: normalizedBase64, relativePath: normalizedBase64 };
  }

  let ext = "png"; // الصيغة الافتراضية
  let base64Data = normalizedBase64;

  // 1. فحص هل النص بيحتوي على المقدمة (data:image...)؟
  const matches = normalizedBase64.match(/^data:(.+);base64,(.+)$/);

  if (matches && matches.length === 3) {
    // لو مبعوتة بالمقدمة، نفصلها وناخد الكود الصافي
    const mimeType = matches[1];
    ext = mimeType.split("/")[1] || "png";
    base64Data = matches[2];
  } else {
    // 2. لو مبعوتة كود صافي (زي الداتا بتاعتك دلوقتي)
    // هنستنتج نوع الصورة من أول حروف الكود
    if (normalizedBase64.startsWith("/9j/")) ext = "jpeg";
    else if (normalizedBase64.startsWith("iVBORw0K")) ext = "png";
    else if (normalizedBase64.startsWith("R0lGOD")) ext = "gif";
    else if (normalizedBase64.startsWith("UklGR")) ext = "webp";
  }

  try {
    // تحويل الكود لملف فعلي
    const buffer = Buffer.from(base64Data, "base64");

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
  } catch (error) {
    throw new BadRequest("Failed to process base64 image data.");
  }
}

export const validateAndSaveLogo = async (req: Request, logo: any, folder: string): Promise<string> => {
  const normalizedLogo = normalizeImagePayload(logo);
  if (!normalizedLogo) {
    return "";
  }

  // شلنا فحص الـ Regex المعقد من هنا عشان دالة saveBase64Image بقت بتعالج كل الحالات
  try {
    const savedUrl = await saveBase64Image(req, logo, folder);
    return savedUrl.url;
  } catch (error: any) {
    throw new BadRequest(`Failed to save logo: ${error.message}`);
  }
};

export const deleteImage = async (image: string) => {
  if (image.includes("data:image") || image.length > 2000) {
    console.warn("Skipping deletion of likely base64 data in image field");
    return;
  }

  const rootDir = path.resolve(__dirname, "../../");
  let relativePath = image;
  if (image.includes("/uploads/")) {
    relativePath = "uploads/" + image.split("/uploads/")[1];
  }

  const imagePath = path.join(rootDir, relativePath);
  try {
    await fs.unlink(imagePath);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.warn(`Image file not found for deletion: ${imagePath}`);
      return;
    }
    console.error(`Failed to delete image: ${error.message}`);
  }
};

export const handleImageUpdate = async (req: Request, oldImage: string | null | undefined, newImage: any, folder: string) => {
  const normalizedNewImage = normalizeImagePayload(newImage);

  if (!normalizedNewImage || normalizedNewImage.startsWith("http")) {
    return (normalizedNewImage && normalizedNewImage.startsWith("http")) ? normalizedNewImage : (oldImage || "");
  }

  const savedUrl = await validateAndSaveLogo(req, normalizedNewImage, folder);

  if (oldImage) {
    await deleteImage(oldImage);
  }

  return savedUrl;
};