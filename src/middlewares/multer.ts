
import multer from 'multer';
import { Request } from 'express';
import { BadRequest } from '../Errors/BadRequest';

// Configure multer storage
const storage = multer.memoryStorage();

// File filter for images
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    // Accept images only
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif|webp)$/)) {
        return cb(new BadRequest('Only image files are allowed!'));
    }
    cb(null, true);
};

export const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
});
