"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const catchAsync_1 = require("../../utils/catchAsync");
const restaurantDomains_1 = require("../../controllers/admin/restaurantDomains");
const validation_1 = require("../../middlewares/validation");
const restaurantDomains_2 = require("../../validation/admin/restaurantDomains");
const router = (0, express_1.Router)();
// Rate limiter for subdomain availability check: 60 req/min
const checkSubdomainLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many subdomain availability checks, please try again later." },
});
// GET /api/admin/domains/check-subdomain?label=flaky
router.get("/check-subdomain", checkSubdomainLimiter, (0, validation_1.validate)(restaurantDomains_2.checkSubdomainQuerySchema, "query"), (0, catchAsync_1.catchAsync)(restaurantDomains_1.checkSubdomain));
// POST /api/admin/domains/:domainId/verify
router.post("/:domainId/verify", (0, validation_1.validate)(restaurantDomains_2.domainIdParamSchema, "params"), (0, catchAsync_1.catchAsync)(restaurantDomains_1.verifyDomain));
// POST /api/admin/domains/:domainId/provision
router.post("/:domainId/provision", (0, validation_1.validate)(restaurantDomains_2.domainIdParamSchema, "params"), (0, catchAsync_1.catchAsync)(restaurantDomains_1.retryProvisioning));
// DELETE /api/admin/domains/:domainId
router.delete("/:domainId", (0, validation_1.validate)(restaurantDomains_2.domainIdParamSchema, "params"), (0, catchAsync_1.catchAsync)(restaurantDomains_1.deleteDomain));
// POST /api/admin/domains/:domainId/set-order-link
router.post("/:domainId/set-order-link", (0, validation_1.validate)(restaurantDomains_2.domainIdParamSchema, "params"), (0, catchAsync_1.catchAsync)(restaurantDomains_1.setOrderLink));
exports.default = router;
