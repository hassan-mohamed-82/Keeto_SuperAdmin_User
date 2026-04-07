"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = void 0;
const promises_1 = __importDefault(require("fs/promises"));
function gatherFiles(req) {
    const files = [];
    if (req.file)
        files.push(req.file);
    if (req.files) {
        if (Array.isArray(req.files)) {
            files.push(...req.files);
        }
        else {
            Object.values(req.files)
                .flat()
                .forEach((file) => {
                files.push(file);
            });
        }
    }
    return files;
}
const validate = (schema, target = "body") => {
    return async (req, res, next) => {
        try {
            const result = schema.safeParse(req[target]);
            if (!result.success) {
                // Clean up uploaded files on validation error
                const files = gatherFiles(req);
                const deleteOps = files.map((file) => file.path
                    ? promises_1.default.unlink(file.path).catch(console.error)
                    : Promise.resolve());
                await Promise.all(deleteOps);
                const errors = result.error.errors.map((e) => ({
                    field: e.path.join('.') || target,
                    message: e.message,
                }));
                res.status(400).json({
                    success: false,
                    error: {
                        code: 400,
                        message: 'Validation failed',
                        details: errors,
                    },
                });
                return;
            }
            // For body, we can reassign. For query/params, just validate (they're read-only in Express 5)
            if (target === "body") {
                req.body = result.data;
            }
            // Parsed data available via result.data, but query/params are read-only in Express 5
            next();
        }
        catch (error) {
            next(error);
        }
    };
};
exports.validate = validate;
