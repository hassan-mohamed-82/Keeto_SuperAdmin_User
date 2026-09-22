import { Router } from "express";
import { validate } from "../../middlewares/validation";
import { paymobWebhookSchema } from "../../validation/payment/paymob.validation";
import { handlePaymobWebhook, handlePaymobRedirect } from "../../controllers/payments/paymobpayment";

const router = Router();

/**
 * @route   POST /payments/paymob/webhook
 * @desc    Paymob Webhook Transaction Callback (Server-to-Server)
 * @access  Public (HMAC Verified)
 */
router.post(
    "/webhook",
    validate(paymobWebhookSchema),
    handlePaymobWebhook
);

/**
 * @route   GET /payments/paymob/callback
 * @desc    User browser redirect after payment completion on Paymob hosted checkout
 * @access  Public (Redirect only)
 */
router.get(
    "/callback",
    handlePaymobRedirect
);

export default router;
