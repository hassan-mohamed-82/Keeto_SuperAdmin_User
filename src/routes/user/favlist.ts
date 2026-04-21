import { Router } from "express";
import { getUserFavorites, toggleFavorite } from "../../controllers/user/home";
import { catchAsync } from "../../utils/catchAsync";
const router = Router();

router.post("/toggle", catchAsync(toggleFavorite));

router.get("/", catchAsync(getUserFavorites));

export default router;