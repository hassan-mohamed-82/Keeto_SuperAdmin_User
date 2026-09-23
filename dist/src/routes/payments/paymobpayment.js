"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const validation_1 = require("../../middlewares/validation");
const paymob_validation_1 = require("../../validation/payment/paymob.validation");
const paymobpayment_1 = require("../../controllers/payments/paymobpayment");
const router = (0, express_1.Router)();
/**
 * @route   POST /payments/paymob/webhook
 * @desc    Paymob Webhook Transaction Callback (Server-to-Server)
 * @access  Public (HMAC Verified)
 */
router.post("/webhook", (0, validation_1.validate)(paymob_validation_1.paymobWebhookSchema), paymobpayment_1.handlePaymobWebhook);
/**
 * @route   GET /payments/paymob/callback
 * @desc    User browser redirect after payment completion on Paymob hosted checkout
 * @access  Public (Redirect only)
 */
router.get("/callback", paymobpayment_1.handlePaymobRedirect);
exports.default = router;
