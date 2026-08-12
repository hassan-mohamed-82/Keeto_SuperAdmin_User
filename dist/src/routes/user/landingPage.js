"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const landingPage_1 = require("../../controllers/user/landingPage");
const router = (0, express_1.Router)();
router.get("/restaurants", landingPage_1.getActiveRestaurants);
exports.default = router;
