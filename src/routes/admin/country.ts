import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
  createCountry,
  getAllCountries,
  getCountryById,
  updateCountry,
  deleteCountry,
} from "../../controllers/admin/country";
import { validate } from "../../middlewares/validation";
import { createCountrySchema, updateCountrySchema } from "../../validation/admin/country";
import { hasPermission } from "../../middlewares/";
const router = Router();

router.post("/", validate(createCountrySchema), hasPermission("Countries", "Add"), catchAsync(createCountry));
router.get("/", hasPermission("Countries", "View"), catchAsync(getAllCountries));
router.get("/:id", hasPermission("Countries", "View"), catchAsync(getCountryById));
router.put("/:id", validate(updateCountrySchema), hasPermission("Countries", "Edit"), catchAsync(updateCountry));
router.delete("/:id", hasPermission("Countries", "Delete"), catchAsync(deleteCountry));

export default router;
