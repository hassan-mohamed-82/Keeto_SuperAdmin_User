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

const router = Router();

router.post("/", catchAsync(createCity));
router.get("/", catchAsync(getAllCities));
router.get("/:id", catchAsync(getCityById));
router.put("/:id", catchAsync(updateCity));
router.delete("/:id", catchAsync(deleteCity));
router.get("/countries/active", catchAsync(getAllCountries));

export default router;