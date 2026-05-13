import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
  createZone,
  getAllZones,
  getZoneById,
  updateZone,
  deleteZone,
  getallcities
} from "../../controllers/admin/zone";
import { hasPermission } from "../../middlewares/";
import { validate } from "../../middlewares/validation";
import { createZoneSchema, updateZoneSchema } from "../../validation/admin/zone";
const router = Router();

router.post("/", hasPermission("Zones", "Add"), validate(createZoneSchema), catchAsync(createZone));
router.get("/", hasPermission("Zones", "View"), catchAsync(getAllZones));
router.get("/:id", hasPermission("Zones", "View"), catchAsync(getZoneById));
router.put("/:id", hasPermission("Zones", "Edit"), validate(updateZoneSchema), catchAsync(updateZone));
router.delete("/:id", hasPermission("Zones", "Delete"), catchAsync(deleteZone));
router.get("/cities/active", catchAsync(getallcities));

export default router;
