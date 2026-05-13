import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
  createCity,
  getAllCities,
  getCityById,
  updateCity,
  deleteCity,
  getAllCountries,
} from "../../controllers/admin/city";
import { validate } from "../../middlewares/validation";
import { createCitySchema, updateCitySchema } from "../../validation/admin/city";
import { hasPermission } from "../../middlewares/";
const router = Router();

router.post("/", validate(createCitySchema), hasPermission("Cities", "Add"), catchAsync(createCity));
router.get("/", hasPermission("Cities", "View"), catchAsync(getAllCities));
router.get("/:id", hasPermission("Cities", "View"), catchAsync(getCityById));
router.put("/:id", validate(updateCitySchema), hasPermission("Cities", "Edit"), catchAsync(updateCity));
router.delete("/:id", hasPermission("Cities", "Delete"), catchAsync(deleteCity));
router.get("/countries/active", hasPermission("Cities", "View"), catchAsync(getAllCountries));

export default router;