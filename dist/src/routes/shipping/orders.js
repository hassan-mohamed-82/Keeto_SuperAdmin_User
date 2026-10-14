"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const orders_1 = require("../../controllers/shipping/orders");
const validation_1 = require("../../middlewares/validation");
const order_1 = require("../../validation/shipping/order");
const authenticated_1 = require("../../middlewares/authenticated");
const shippingAuth_1 = require("../../middlewares/shippingAuth");
const auth_1 = require("../../controllers/shipping/auth");
const auth_2 = require("../../validation/shipping/auth");
const order_2 = require("../../validation/shipping/order");
const shippingAuth_2 = require("../../middlewares/shippingAuth");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, message: "Too many login attempts. Please try again after 15 minutes." },
});
const router = (0, express_1.Router)();
router.use(authenticated_1.authenticated);
router.get("/", (0, shippingAuth_1.requireShippingCompany)(), (0, validation_1.validate)(order_1.filterShippingOrdersSchema), orders_1.getOrders);
router.get("/:id", (0, shippingAuth_1.requireShippingCompany)(), orders_1.getOrderDetails);
router.post("/:id/assign", (0, shippingAuth_1.requireShippingCompany)("admin", "dispatcher"), (0, validation_1.validate)(order_1.assignOrderDeliveryManSchema), orders_1.manualAssignDeliveryMan);
router.post("/:id/auto-assign", (0, shippingAuth_1.requireShippingCompany)("admin", "dispatcher"), (0, validation_1.validate)(order_1.autoAssignOrderSchema), orders_1.autoAssignOrder);
// Courier Auth
router.post("/auth/login", authLimiter, (0, validation_1.validate)(auth_2.courierLoginSchema), auth_1.courierLogin);
// Courier Me
router.get("/me", authenticated_1.authenticated, shippingAuth_2.requireDeliveryMan, auth_1.getCourierProfile);
// Courier Order lifecycle endpoints (Phase 8)
router.post("/orders/:id/picked-up", authenticated_1.authenticated, shippingAuth_2.requireDeliveryMan, orders_1.markOrderPickedUp);
router.post("/orders/:id/delivered", authenticated_1.authenticated, shippingAuth_2.requireDeliveryMan, orders_1.markOrderDelivered);
router.post("/orders/:id/reject", authenticated_1.authenticated, shippingAuth_2.requireDeliveryMan, (0, validation_1.validate)(order_2.rejectOrderSchema), orders_1.rejectOrderCourierEndpoint);
exports.default = router;
