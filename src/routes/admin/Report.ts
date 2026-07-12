import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { getFinancialReport, getDetailedRestaurantReport, getSingleRestaurantReport, generateRestaurantInvoicePDF,generateAndSaveInvoice,markInvoiceAsPaid, getRestaurantInvoices, getRestaurantOrdersReport } from "../../controllers/admin/Report"
import { hasPermission } from "../../middlewares/";
import{getSuperAdminDashboard}from "../../controllers/admin/dashboard"
const router = Router();

router.get("/dashboard",  catchAsync(getSuperAdminDashboard))
router.get("/", hasPermission("reports", "View"), catchAsync(getFinancialReport))
router.get("/detailed", hasPermission("reports", "View"), catchAsync(getDetailedRestaurantReport))
router.get("/restaurant/:restaurantId", hasPermission("reports", "View"), catchAsync(getSingleRestaurantReport))
router.get("/restaurant/:restaurantId/invoices", hasPermission("reports", "View"), catchAsync(getRestaurantInvoices))
router.get("/invoice/:invoiceId/pdf", hasPermission("reports", "View"), catchAsync(generateRestaurantInvoicePDF))
router.post("/restaurant/invoice", hasPermission("reports", "View"), catchAsync(generateAndSaveInvoice))
router.put("/invoice/:invoiceId/mark-paid", hasPermission("reports", "Edit"), catchAsync(markInvoiceAsPaid))

router.get("/restaurant-orders", hasPermission("reports", "View"), catchAsync(getRestaurantOrdersReport));

export default router;