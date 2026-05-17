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
import { validate } from "../../middlewares/validation";
import { createRestaurantSchema, updateRestaurantSchema } from "../../validation/admin/restaurants";
import { hasPermission } from "../../middlewares/";
const router = Router();
router.get("/select", catchAsync(getallcousinesandzones));
router.post("/", hasPermission("Restaurants", "Add"), 
// validate(createRestaurantSchema),
 catchAsync(createRestaurant));
router.get("/", hasPermission("Restaurants", "View"), catchAsync(getAllRestaurants));
router.get("/:id", hasPermission("Restaurants", "View"), catchAsync(getRestaurantById));
router.put("/:id", hasPermission("Restaurants", "Edit"),
//  validate(updateRestaurantSchema), 
 catchAsync(updateRestaurant));
router.delete("/:id", hasPermission("Restaurants", "Delete"), catchAsync(deleteRestaurant));

export default router;
