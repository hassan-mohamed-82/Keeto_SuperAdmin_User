import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { getFinancialReport } from "../../controllers/admin/Report"
import { hasPermission } from "../../middlewares/";

const router = Router();

router.get("/", hasPermission("reports", "View"), catchAsync(getFinancialReport))

export default router;