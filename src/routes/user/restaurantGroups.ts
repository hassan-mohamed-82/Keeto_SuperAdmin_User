import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
    getRestaurantGroupsByLocation,
    getUserRestaurantGroupById,
} from "../../controllers/user/restaurantGroups";
import { optionalAuth } from "../../middlewares/authenticated";

const router = Router();

// ==========================================
// User Restaurant Groups Endpoints
// ==========================================

// 1. Get restaurant group(s) by user coordinates (lat, lng)
// router.get("/by-location", optionalAuth, catchAsync(getRestaurantGroupsByLocation));
router.post("/by-location", optionalAuth, catchAsync(getRestaurantGroupsByLocation));

// 2. Get single restaurant group details & restaurants list
router.get("/:id", optionalAuth, catchAsync(getUserRestaurantGroupById));

export default router;
