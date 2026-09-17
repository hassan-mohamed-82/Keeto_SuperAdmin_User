import { Router } from "express";
import { validate } from "../middlewares/validation";
import {
    sessionSchema,
    generateHashSchema,
    directChargeSchema,
    webhookSchema,
} from "../validation/payment/kashier.validation";
import {
    generatePaymentSession,
    generateOrderHash,
    processDirectCharge,
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
 * @route   POST /api/payments/kashier/hash
 * @desc    Generate HMAC-SHA256 signature hash for an order
 * @access  Public / Authenticated
 */
router.post(
    "/kashier/hash",
    validate(generateHashSchema),
    generateOrderHash
);

/**
 * @route   POST /api/payments/kashier/charge
 * @desc    Direct card charge via Kashier Checkout
 * @access  Public / Authenticated
 */
router.post(
    "/kashier/charge",
    validate(directChargeSchema),
    processDirectCharge
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
