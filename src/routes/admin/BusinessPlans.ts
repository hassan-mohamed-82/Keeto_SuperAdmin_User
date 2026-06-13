import { Router } from "express";
import { createBusinessPlan,
      updateBusinessPlan,
       deleteBusinessPlan,
       getBusinessPlanById,
       getBusinessPlansByRestaurant,
       getallresstrauntplans
     } from "../../controllers/admin/BusinessPlans";
     import { catchAsync } from "../../utils/catchAsync";
     import { validate } from "../../middlewares/validation";
     import { createBusinessPlanSchema, updateBusinessPlanSchema } from "../../validation/admin/BusinessPlans";
     import { hasPermission } from "../../middlewares/";
const router = Router();


router.get("/", hasPermission("BusninessPlan", "View"), catchAsync(getallresstrauntplans));
router.post("/",// validate(createBusinessPlanSchema),
 hasPermission("BusninessPlan", "Add"), catchAsync(createBusinessPlan));
router.get("/restaurant/:restaurantId", hasPermission("BusninessPlan", "View"), catchAsync(getBusinessPlansByRestaurant));
router.get("/:id", hasPermission("BusninessPlan", "View"), catchAsync(getBusinessPlanById));
router.put("/:id",// validate(updateBusinessPlanSchema)
 hasPermission("BusninessPlan", "Edit"), catchAsync(updateBusinessPlan));
router.delete("/:id", hasPermission("BusninessPlan", "Delete"), catchAsync(deleteBusinessPlan));


export default router;