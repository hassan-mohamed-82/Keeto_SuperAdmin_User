import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
    getSuperAdminDashboard,
    getDashboardTargets,
    upsertDashboardTargets,
} from "../../controllers/admin/dashboard";

const router = Router();

// SuperAdmin Dashboard Analytics
// GET /dashboard/analytics?startDate=2026-01-01&endDate=2026-06-30
router.get("/", catchAsync(getSuperAdminDashboard));

// Dashboard Targets CRUD
// GET /dashboard/targets
router.get("/targets", catchAsync(getDashboardTargets));

// PUT /dashboard/targets
// Body: { totalOrdersTarget: 60, totalCustomersTarget: 100, totalRestaurantsTarget: 20 }
router.put("/targets", catchAsync(upsertDashboardTargets));

export default router;
