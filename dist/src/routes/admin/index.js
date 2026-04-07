"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const admin_1 = __importDefault(require("./admin"));
const auth_1 = __importDefault(require("./auth"));
const roles_1 = __importDefault(require("./roles"));
const authenticated_1 = require("../../middlewares/authenticated");
const authorized_1 = require("../../middlewares/authorized");
const router = (0, express_1.Router)();
router.use("/auth", auth_1.default);
router.use(authenticated_1.authenticated, (0, authorized_1.authorizeRoles)("superadmin", "admin"));
router.use("/admin", admin_1.default);
router.use("/roles", roles_1.default);
exports.default = router;
