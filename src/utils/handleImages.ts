import path from "path";
import fs from "fs/promises";
import { Request } from "express";
import { BadRequest } from "../Errors/BadRequest";
import { BASE64_IMAGE_REGEX } from "../types/constant";

export async function saveBase64Image(
  base64: string,
  req: Request,
  folder: string
): Promise<string> {
  const matches = base64.match(/^data:(.+);base64,(.+)$/);
  let ext = "png";
  let data = base64;

  if (matches && matches.length === 3) {
    const rawExt = matches[1].split("/")[1];
    // Sanitize extension to prevent path traversal
    ext = rawExt.replace(/[^a-zA-Z0-9]/g, "") || "png";
    data = matches[2];
  }

  const buffer = Buffer.from(data, "base64");
  const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`;

  const rootDir = path.resolve(__dirname, "../../");
  const uploadsDir = path.join(rootDir, "uploads", folder);

  try {
    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.writeFile(path.join(uploadsDir, fileName), buffer);
  } catch (err) {
    console.error("❌ Failed to save image:", err);
    throw err;
  }

  const protocol = req.get("x-forwarded-proto") || req.protocol || "https";

  return `${protocol}://${req.get("host")}/uploads/${folder}/${fileName}`;
}

export const validateAndSaveLogo = async (req: Request, logo: string, folder: string): Promise<string> => {
  if (!logo.match(BASE64_IMAGE_REGEX)) {
    throw new BadRequest("Invalid logo format. Must be a base64 encoded image (JPEG, PNG, GIF, or WebP)");
  }
  try {
    const savedUrl = await saveBase64Image(logo, req, folder);
    return savedUrl;
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

export const handleImageUpdate = async (req: Request, oldImage: string | null | undefined, newImage: string | undefined, folder: string) => {
  if (!newImage || newImage.startsWith("http")) {
    return newImage || oldImage;
  }

  const savedUrl = await validateAndSaveLogo(req, newImage, folder);

  if (oldImage) {
    await deleteImage(oldImage);
  }

  return savedUrl;
};