"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const users_1 = require("../../controllers/shipping/users");
const authenticated_1 = require("../../middlewares/authenticated");
const shippingAuth_1 = require("../../middlewares/shippingAuth");
const validation_1 = require("../../middlewares/validation");
const auth_1 = require("../../validation/shipping/auth");
const router = (0, express_1.Router)();
// All user management routes require authenticated shipping company admin
router.use(authenticated_1.authenticated, (0, shippingAuth_1.requireShippingCompany)("admin"));
router.get("/", users_1.getCompanyUsers);
router.post("/", (0, validation_1.validate)(auth_1.createCompanyUserSchema), users_1.createCompanyUser);
router.put("/:id", (0, validation_1.validate)(auth_1.updateCompanyUserSchema), users_1.updateCompanyUser);
router.delete("/:id", users_1.deleteCompanyUser);
exports.default = router;
