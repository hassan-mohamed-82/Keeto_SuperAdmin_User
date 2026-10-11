"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = __importDefault(require("./auth"));
const restaurants_1 = __importDefault(require("./restaurants"));
const zones_1 = __importDefault(require("./zones"));
const deliveryMen_1 = __importDefault(require("./deliveryMen"));
const orders_1 = __importDefault(require("./orders"));
const router = (0, express_1.Router)();
router.use("/auth", auth_1.default);
router.use("/restaurants", restaurants_1.default);
router.use("/zones", zones_1.default);
router.use("/delivery-men", deliveryMen_1.default);
router.use("/orders", orders_1.default);
exports.default = router;
