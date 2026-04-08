import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
  createRestaurant,
  getAllRestaurants,
  getRestaurantById,
  updateRestaurant,
  deleteRestaurant,
  getallcousinesandzones,
} from "../../controllers/admin/restaurants";

const router = Router();
router.get("/select", catchAsync(getallcousinesandzones));
router.post("/", catchAsync(createRestaurant));
router.get("/", catchAsync(getAllRestaurants));
router.get("/:id", catchAsync(getRestaurantById));
router.put("/:id", catchAsync(updateRestaurant));
router.delete("/:id", catchAsync(deleteRestaurant));

export default router;
