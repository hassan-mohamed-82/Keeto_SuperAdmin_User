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

const router = Router();
router.get("/select", catchAsync(getAllRestaurantsandaddonscategory));
router.post("/", catchAsync(createAddon));
router.get("/", catchAsync(getAllAddons));
router.get("/:id", catchAsync(getAddonById));
router.put("/:id", catchAsync(updateAddon));
router.delete("/:id", catchAsync(deleteAddon));

export default router;