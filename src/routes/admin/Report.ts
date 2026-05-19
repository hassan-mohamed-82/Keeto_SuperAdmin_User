import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { getFinancialReport, getDetailedRestaurantReport } from "../../controllers/admin/Report"
import { hasPermission } from "../../middlewares/";

const router = Router();

router.get("/", hasPermission("reports", "View"), catchAsync(getFinancialReport))
router.get("/detailed", hasPermission("reports", "View"), catchAsync(getDetailedRestaurantReport))

export default router;