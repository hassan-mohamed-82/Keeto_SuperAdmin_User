"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const validation_1 = require("../../middlewares/validation");
const geidea_validation_1 = require("../../validation/payment/geidea.validation");
const geideapayment_1 = require("../../controllers/payments/geideapayment");
const router = (0, express_1.Router)();
/**
 * @route   POST /payments/geidea/session
 * @desc    Create or retry a Geidea hosted payment session for an existing order
 * @access  Public / Authenticated
 */
router.post("/session", (0, validation_1.validate)(geidea_validation_1.geideaSessionSchema), geideapayment_1.generateGeideaPaymentSession);
/**
 * @route   POST /payments/geidea/webhook
 * @desc    Geidea Webhook Transaction Callback (Server-to-Server)
 * @access  Public
 */
router.post("/webhook", (0, validation_1.validate)(geidea_validation_1.geideaWebhookSchema), geideapayment_1.handleGeideaWebhook);
/**
 * @route   GET /payments/geidea/callback
 * @desc    User browser redirect after payment completion on Geidea hosted checkout
 * @access  Public (Redirect only)
 */
router.get("/callback", geideapayment_1.handleGeideaRedirect);
exports.default = router;
