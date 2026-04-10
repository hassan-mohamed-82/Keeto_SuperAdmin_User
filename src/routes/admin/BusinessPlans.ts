import { Router } from "express";
import { createBusinessPlan,
      updateBusinessPlan,
       deleteBusinessPlan,
       getBusinessPlanById,
       getBusinessPlansByRestaurant
     } from "../../controllers/admin/BusinessPlans";
    

const router = Router();

router.post("/", createBusinessPlan);
router.get("/restaurant/:restaurantId", getBusinessPlansByRestaurant);
router.get("/:id", getBusinessPlanById);
router.put("/:id", updateBusinessPlan);
router.delete("/:id", deleteBusinessPlan);

export default router;