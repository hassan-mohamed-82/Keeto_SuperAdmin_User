"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const catchAsync_1 = require("../../utils/catchAsync");
const dashboard_1 = require("../../controllers/admin/dashboard");
const router = (0, express_1.Router)();
// SuperAdmin Dashboard Analytics
// GET /dashboard/analytics?startDate=2026-01-01&endDate=2026-06-30
router.get("/", (0, catchAsync_1.catchAsync)(dashboard_1.getSuperAdminDashboard));
// Dashboard Targets CRUD
// GET /dashboard/targets
router.get("/targets", (0, catchAsync_1.catchAsync)(dashboard_1.getDashboardTargets));
// PUT /dashboard/targets
// Body: { totalOrdersTarget: 60, totalCustomersTarget: 100, totalRestaurantsTarget: 20 }
router.put("/targets", (0, catchAsync_1.catchAsync)(dashboard_1.upsertDashboardTargets));
exports.default = router;
