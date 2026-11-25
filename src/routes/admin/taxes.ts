import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { validate } from "../../middlewares/validation";
import { hasPermission } from "../../middlewares/";
import { createKeetoTaxSchema, updateKeetoTaxSchema } from "../../validation/admin/taxes";
import {
    createTax,
    getAllTaxes,
    getTaxOptions,
    getTaxById,
    updateTax,
    toggleTaxStatus,
    deleteTax,
} from "../../controllers/admin/taxes";

const router = Router();

router.post("/", hasPermission("Taxes", "Add"), validate(createKeetoTaxSchema), catchAsync(createTax));
router.get("/", hasPermission("Taxes", "View"), catchAsync(getAllTaxes));
router.get("/options", hasPermission("Taxes", "View"), catchAsync(getTaxOptions));
router.get("/:id", hasPermission("Taxes", "View"), catchAsync(getTaxById));
router.put("/:id", hasPermission("Taxes", "Edit"), validate(updateKeetoTaxSchema), catchAsync(updateTax));
router.patch("/:id/status", hasPermission("Taxes", "Status"), catchAsync(toggleTaxStatus));
router.delete("/:id", hasPermission("Taxes", "Delete"), catchAsync(deleteTax));

export default router;
