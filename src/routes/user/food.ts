import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { getProductById } from "../../controllers/user/food";
import { validate } from "../../middlewares/validation";
import { optionalAuth } from "../../middlewares/authenticated";
import {
    getFoodByIdParamsSchema,
    getFoodByIdQuerySchema,
} from "../../validation/user/food";

const router = Router();

// GET /:id — Get product by ID with full details & discount details
router.get(
    "/:id",
    optionalAuth,
    validate(getFoodByIdParamsSchema, "params"),
    catchAsync(getProductById)
);

export default router;
