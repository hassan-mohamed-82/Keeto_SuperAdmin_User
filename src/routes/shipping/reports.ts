import { Router } from "express";
import { getSummaryReport, getCourierPerformanceReport } from "../../controllers/shipping/reports";
import { authenticated } from "../../middlewares/authenticated";
import { requireShippingCompany } from "../../middlewares/shippingAuth";
import { validate } from "../../middlewares/validation";
import { reportsDateRangeSchema } from "../../validation/shipping/report";

const router = Router();

router.use(authenticated, requireShippingCompany());

router.get("/summary", validate(reportsDateRangeSchema, "query"), getSummaryReport);
router.get("/couriers", validate(reportsDateRangeSchema, "query"), getCourierPerformanceReport);

export default router;
