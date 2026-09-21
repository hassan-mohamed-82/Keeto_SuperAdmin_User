import { Router } from "express";
import { validate } from "../middlewares/validation";
import {
    sessionSchema,
    webhookSchema,
} from "../validation/payment/kashier.validation";
import {
    generatePaymentSession,
    handleKashierWebhook,
} from "../controllers/payment.controller";

const router = Router();

/**
 * @route   POST /api/v1/payments/kashier/session (also /api/payments/kashier/session)
 * @desc    Create a hosted payment session via Kashier Payment Sessions API (returns sessionUrl)
 * @access  Public / Authenticated
 */
router.post(
    "/kashier/session",
    validate(sessionSchema),
    generatePaymentSession
);

/**
 * @route   POST /api/payments/kashier/webhook
 * @desc    Asynchronous payment notification webhook from Kashier
 * @access  Public (Signature Verified)
 */
router.post(
    "/kashier/webhook",
    validate(webhookSchema),
    handleKashierWebhook
);

export default router;
