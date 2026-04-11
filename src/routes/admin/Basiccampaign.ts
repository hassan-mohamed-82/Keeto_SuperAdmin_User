import { Router } from "express";
import { createBasiccampaign, getAllBasiccampaigns,
     getBasiccampaignById, updateBasiccampaign, 
     deleteBasiccampaign, updateBasiccampaignStatus 
     } from "../../controllers/admin/Basiccampaign";
import { catchAsync } from "../../utils/catchAsync";

const router = Router();

router.post("/", catchAsync(createBasiccampaign));
router.get("/", catchAsync(getAllBasiccampaigns));
router.get("/:id", catchAsync(getBasiccampaignById));
router.put("/:id", catchAsync(updateBasiccampaign));
router.delete("/:id", catchAsync(deleteBasiccampaign));
router.put("/:id/status", catchAsync(updateBasiccampaignStatus));

export default router;