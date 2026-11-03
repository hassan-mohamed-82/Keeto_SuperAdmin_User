import { Router } from "express";
import { validate } from "../../middlewares/validation";
import {
    sessionSchema,
    webhookSchema,
} from "../../validation/payment/kashier.validation";
import {
    generatePaymentSession,
    handleKashierWebhook,
    handleKashierRedirect,
    triggerKashierSync,
} from "../../controllers/payments/kashierpayment";

const router = Router();

/**
 * @route   POST /api/v1/payments/kashier/session (also /api/payments/kashier/session)
 * @desc    Create a hosted payment session via Kashier Payment Sessions API (returns sessionUrl)
 * @access  Public / Authenticated
 */
router.post(
    "/session",
    validate(sessionSchema),
    generatePaymentSession
);

/**
 * @route   POST /api/payments/kashier/webhook
 * @desc    Asynchronous payment notification webhook from Kashier
 * @access  Public (Signature Verified)
 */
router.post(
    "/webhook",
    validate(webhookSchema),
    handleKashierWebhook
);

/**
 * @route   GET /payments/kashier/callback
 * @desc    User browser redirect after payment completion on Kashier hosted checkout
 * @access  Public (Redirect only)
 */
router.get(
    "/callback",
    handleKashierRedirect
);

/**
 * @route   POST & GET /api/payments/kashier/sync
 * @desc    Manually trigger sync for pending Kashier orders (supports POST & GET for easy browser/Postman testing)
 * @access  Public / Admin
 */
router.post("/sync", triggerKashierSync);
router.get("/sync", triggerKashierSync);

export default router;
