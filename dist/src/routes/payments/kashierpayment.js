"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const validation_1 = require("../../middlewares/validation");
const kashier_validation_1 = require("../../validation/payment/kashier.validation");
const kashierpayment_1 = require("../../controllers/payments/kashierpayment");
const router = (0, express_1.Router)();
/**
 * @route   POST /api/v1/payments/kashier/session (also /api/payments/kashier/session)
 * @desc    Create a hosted payment session via Kashier Payment Sessions API (returns sessionUrl)
 * @access  Public / Authenticated
 */
router.post("/session", (0, validation_1.validate)(kashier_validation_1.sessionSchema), kashierpayment_1.generatePaymentSession);
/**
 * @route   POST /api/payments/kashier/webhook
 * @desc    Asynchronous payment notification webhook from Kashier
 * @access  Public (Signature Verified)
 */
router.post("/webhook", (0, validation_1.validate)(kashier_validation_1.webhookSchema), kashierpayment_1.handleKashierWebhook);
exports.default = router;
