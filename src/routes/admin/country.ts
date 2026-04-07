import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
  createCountry,
  getAllCountries,
  getCountryById,
  updateCountry,
  deleteCountry,
} from "../../controllers/admin/country";

const router = Router();

router.post("/", catchAsync(createCountry));
router.get("/", catchAsync(getAllCountries));
router.get("/:id", catchAsync(getCountryById));
router.put("/:id", catchAsync(updateCountry));
router.delete("/:id", catchAsync(deleteCountry));

export default router;
