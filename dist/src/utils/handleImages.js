"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleImageUpdate = exports.deleteImage = exports.validateAndSaveLogo = void 0;
exports.saveBase64Image = saveBase64Image;
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const BadRequest_1 = require("../Errors/BadRequest");
const constant_1 = require("../types/constant");
async function saveBase64Image(base64, req, folder) {
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
    const rootDir = path_1.default.resolve(__dirname, "../../");
    const uploadsDir = path_1.default.join(rootDir, "uploads", folder);
    try {
        await promises_1.default.mkdir(uploadsDir, { recursive: true });
        await promises_1.default.writeFile(path_1.default.join(uploadsDir, fileName), buffer);
    }
    catch (err) {
        console.error("❌ Failed to save image:", err);
        throw err;
    }
    const protocol = req.get("x-forwarded-proto") || req.protocol || "https";
    return `${protocol}://${req.get("host")}/uploads/${folder}/${fileName}`;
}
const validateAndSaveLogo = async (req, logo, folder) => {
    if (!logo.match(constant_1.BASE64_IMAGE_REGEX)) {
        throw new BadRequest_1.BadRequest("Invalid logo format. Must be a base64 encoded image (JPEG, PNG, GIF, or WebP)");
    }
    try {
        const savedUrl = await saveBase64Image(logo, req, folder);
        return savedUrl;
    }
    catch (error) {
        throw new BadRequest_1.BadRequest(`Failed to save logo: ${error.message}`);
    }
};
exports.validateAndSaveLogo = validateAndSaveLogo;
const deleteImage = async (image) => {
    if (image.includes("data:image") || image.length > 2000) {
        console.warn("Skipping deletion of likely base64 data in image field");
        return;
    }
    const rootDir = path_1.default.resolve(__dirname, "../../");
    let relativePath = image;
    if (image.includes("/uploads/")) {
        relativePath = "uploads/" + image.split("/uploads/")[1];
    }
    const imagePath = path_1.default.join(rootDir, relativePath);
    try {
        await promises_1.default.unlink(imagePath);
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            console.warn(`Image file not found for deletion: ${imagePath}`);
            return;
        }
        console.error(`Failed to delete image: ${error.message}`);
    }
};
exports.deleteImage = deleteImage;
const handleImageUpdate = async (req, oldImage, newImage, folder) => {
    if (!newImage || newImage.startsWith("http")) {
        return newImage || oldImage;
    }
    const savedUrl = await (0, exports.validateAndSaveLogo)(req, newImage, folder);
    if (oldImage) {
        await (0, exports.deleteImage)(oldImage);
    }
    return savedUrl;
};
exports.handleImageUpdate = handleImageUpdate;
