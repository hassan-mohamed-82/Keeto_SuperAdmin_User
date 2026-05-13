import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
    createAddon,
    getAllAddons,
    getAddonById,
    updateAddon,
    deleteAddon,
    getAllRestaurantsandaddonscategory,
} from "../../controllers/admin/addon";
import { validate } from "../../middlewares/validation";
import { createAddonSchema, updateAddonSchema } from "../../validation/admin/addon";
import { hasPermission } from "../../middlewares/";
import { MODULES } from "../../types/constant";

const router = Router();
router.get("/select", catchAsync(getAllRestaurantsandaddonscategory));
router.post("/", validate(createAddonSchema), hasPermission("Adones", "Add"), catchAsync(createAddon));
router.get("/", hasPermission("Adones", "View"), catchAsync(getAllAddons));
router.get("/:id", hasPermission("Adones", "View"), catchAsync(getAddonById));
router.put("/:id", validate(updateAddonSchema), hasPermission("Adones", "Edit"), catchAsync(updateAddon));
router.delete("/:id", hasPermission("Adones", "Delete"), catchAsync(deleteAddon));

export default router;