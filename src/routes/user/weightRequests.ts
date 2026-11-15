import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { validate } from "../../middlewares/validation";
import {
    sendWeightRequest,
    getWeightRequestById,
    cancelWeightRequest,
} from "../../controllers/user/weightRequests";
import {
    sendWeightRequestSchema,
    cancelWeightRequestSchema,
    getWeightRequestParamSchema,
} from "../../validation/user/weightRequests";

const router = Router();

// Send cart for weighing
router.post("/", validate(sendWeightRequestSchema), catchAsync(sendWeightRequest));

// Get weight request details
router.get("/:id", validate(getWeightRequestParamSchema, "params"), catchAsync(getWeightRequestById));

// Cancel weight request
router.post(
    "/:id/cancel",
    validate(getWeightRequestParamSchema, "params"),
    validate(cancelWeightRequestSchema),
    catchAsync(cancelWeightRequest)
);

export default router;
