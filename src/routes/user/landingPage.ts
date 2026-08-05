import { Router } from "express";
import { getActiveRestaurants } from "../../controllers/user/landingPage";

const router = Router();

router.get("/restaurants", getActiveRestaurants);

export default router;
