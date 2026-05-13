import { Router } from "express";
import { createBasiccampaign, getAllBasiccampaigns,
     getBasiccampaignById, updateBasiccampaign, 
     deleteBasiccampaign, updateBasiccampaignStatus 
     } from "../../controllers/admin/Basiccampaign";
import { catchAsync } from "../../utils/catchAsync";
import { validate } from "../../middlewares/validation";
import { createBasicCampaignSchema, updateBasicCampaignSchema } from "../../validation/admin/Basiccampaign";
import { hasPermission } from "../../middlewares/";
const router = Router();
router.post("/", validate(createBasicCampaignSchema), hasPermission("basiccampaign", "Add"), catchAsync(createBasiccampaign));
router.get("/", hasPermission("basiccampaign", "View"), catchAsync(getAllBasiccampaigns));
router.get("/:id", hasPermission("basiccampaign", "View"), catchAsync(getBasiccampaignById));
router.put("/:id", validate(updateBasicCampaignSchema), hasPermission("basiccampaign", "Edit"), catchAsync(updateBasiccampaign));
router.delete("/:id", hasPermission("basiccampaign", "Delete"), catchAsync(deleteBasiccampaign));
router.put("/:id/status", hasPermission("basiccampaign", "Status"), catchAsync(updateBasiccampaignStatus));

export default router;