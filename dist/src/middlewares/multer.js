"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadVideo = exports.upload = void 0;
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const crypto_1 = require("crypto");
const BadRequest_1 = require("../Errors/BadRequest");
// Configure multer storage
const storage = multer_1.default.memoryStorage();
// File filter for images
const fileFilter = (req, file, cb) => {
    // Accept images only
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        return cb(new BadRequest_1.BadRequest('Only image files are allowed!'));
    }
    cb(null, true);
};
exports.upload = (0, multer_1.default)({
    storage: storage,
    fileFilter: fileFilter,
    // limits: {
    //     fileSize: 10 * 1024 * 1024, // 10MB limit
    // },
});
// Configure disk storage for videos
const videoStorage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path_1.default.join(process.cwd(), 'uploads', 'videos');
        fs_1.default.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        cb(null, `${(0, crypto_1.randomUUID)()}${ext}`);
    },
});
const videoFileFilter = (req, file, cb) => {
    if (file.fieldname === 'thumbnail') {
        if (!file.originalname.match(/\.(jpg|jpeg|png|webp)$/i)) {
            return cb(new BadRequest_1.BadRequest('Only image files (jpg, jpeg, png, webp) are allowed for thumbnail!'));
        }
        return cb(null, true);
    }
    if (!file.originalname.match(/\.(mp4|mkv|mov|avi|webm|flv|wmv|m4v|3gp)$/i)) {
        return cb(new BadRequest_1.BadRequest('Only video files (mp4, mkv, mov, avi, webm, flv, wmv, m4v, 3gp) are allowed!'));
    }
    cb(null, true);
};
exports.uploadVideo = (0, multer_1.default)({
    storage: videoStorage,
    fileFilter: videoFileFilter,
    // limits: {
    //     fileSize: 200 * 1024 * 1024, // 200MB limit
    // },
});
