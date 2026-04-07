import { Request, Response, NextFunction, RequestHandler } from "express";
import { ZodSchema, ZodError } from "zod";
import fs from "fs/promises";

function gatherFiles(req: Request): Express.Multer.File[] {
  const files: Express.Multer.File[] = [];
  if (req.file) files.push(req.file);
  if (req.files) {
    if (Array.isArray(req.files)) {
      files.push(...req.files);
    } else {
      Object.values(req.files)
        .flat()
        .forEach((file) => {
          files.push(file);
        });
    }
  }
  return files;
}

export const validate = (
  schema: ZodSchema,
  target: "body" | "query" | "params" = "body"
): RequestHandler => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const result = schema.safeParse(req[target]);

      if (!result.success) {
        // Clean up uploaded files on validation error
        const files = gatherFiles(req);
        const deleteOps = files.map((file) =>
          file.path
            ? fs.unlink(file.path).catch(console.error)
            : Promise.resolve()
        );
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
    } catch (error) {
      next(error);
    }
  };
};
