import multer from 'multer';
import { Request } from 'express';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { BadRequest } from '../Errors/BadRequest';

// Configure multer storage
const storage = multer.memoryStorage();

// File filter for images
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    // Accept images only
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        return cb(new BadRequest('Only image files are allowed!'));
    }
    cb(null, true);
};

export const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    // limits: {
    //     fileSize: 10 * 1024 * 1024, // 10MB limit
    // },
});

// Configure disk storage for videos
const videoStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(process.cwd(), 'uploads', 'videos');
        fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${randomUUID()}${ext}`);
    },
});

const videoFileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (file.fieldname === 'thumbnail') {
        if (!file.originalname.match(/\.(jpg|jpeg|png|webp)$/i)) {
            return cb(new BadRequest('Only image files (jpg, jpeg, png, webp) are allowed for thumbnail!'));
        }
        return cb(null, true);
    }

    if (!file.originalname.match(/\.(mp4|mkv|mov|avi|webm|flv|wmv|m4v|3gp)$/i)) {
        return cb(new BadRequest('Only video files (mp4, mkv, mov, avi, webm, flv, wmv, m4v, 3gp) are allowed!'));
    }
    cb(null, true);
};

export const uploadVideo = multer({
    storage: videoStorage,
    fileFilter: videoFileFilter,
    // limits: {
    //     fileSize: 200 * 1024 * 1024, // 200MB limit
    // },
});

