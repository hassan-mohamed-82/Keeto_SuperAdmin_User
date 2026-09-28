import { Router } from "express";
import { validate } from "../../middlewares/validation";
import { geideaSessionSchema, geideaWebhookSchema } from "../../validation/payment/geidea.validation";
import {
    generateGeideaPaymentSession,
    handleGeideaWebhook,
    handleGeideaRedirect,
} from "../../controllers/payments/geideapayment";

const router = Router();

/**
 * @route   POST /payments/geidea/session
 * @desc    Create or retry a Geidea hosted payment session for an existing order
 * @access  Public / Authenticated
 */
router.post(
    "/session",
    validate(geideaSessionSchema),
    generateGeideaPaymentSession
);

/**
 * @route   POST /payments/geidea/webhook
 * @desc    Geidea Webhook Transaction Callback (Server-to-Server)
 * @access  Public
 */
router.post(
    "/webhook",
    validate(geideaWebhookSchema),
    handleGeideaWebhook
);

/**
 * @route   GET /payments/geidea/callback
 * @desc    User browser redirect after payment completion on Geidea hosted checkout
 * @access  Public (Redirect only)
 */
router.get(
    "/callback",
    handleGeideaRedirect
);

export default router;
