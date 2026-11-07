"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const catchAsync_1 = require("../utils/catchAsync");
const restaurantDomains_1 = require("../controllers/admin/restaurantDomains");
const validation_1 = require("../middlewares/validation");
const restaurantDomains_2 = require("../validation/admin/restaurantDomains");
const router = (0, express_1.Router)();
// Rate limit: 30 req/min per IP
const resolveLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." },
});
// GET /api/resolve-domain?host=order.pizzaking.com
router.get("/", resolveLimiter, (0, validation_1.validate)(restaurantDomains_2.resolveDomainQuerySchema, "query"), (0, catchAsync_1.catchAsync)(restaurantDomains_1.resolveDomain));
exports.default = router;
