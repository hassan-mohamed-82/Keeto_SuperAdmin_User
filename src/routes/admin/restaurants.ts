import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
  createRestaurant,
  getAllRestaurants,
  getRestaurantById,
  updateRestaurant,
  deleteRestaurant,
  getallcousinesandzones,
  getActiveSales,
  changeDeliveryStatus,
    getRestaurantSelectData
} from "../../controllers/admin/restaurants";
import { validate } from "../../middlewares/validation";
import { createRestaurantSchema, updateRestaurantSchema } from "../../validation/admin/restaurants";
import { hasPermission } from "../../middlewares/";
import { listDomains, addDomain } from "../../controllers/admin/restaurantDomains";
import { addDomainSchema, restaurantIdParamSchema } from "../../validation/admin/restaurantDomains";

const router = Router();
router.get("/select", catchAsync(getallcousinesandzones));
router.get("/select-data", catchAsync(getRestaurantSelectData));
router.get("/sales/active", catchAsync(getActiveSales));
router.post("/", hasPermission("Restaurants", "Add"), 
// validate(createRestaurantSchema),
 catchAsync(createRestaurant));
router.get("/", hasPermission("Restaurants", "View"), catchAsync(getAllRestaurants));
router.get("/:id", hasPermission("Restaurants", "View"), catchAsync(getRestaurantById));
router.put("/:id", hasPermission("Restaurants", "Edit"),
//  validate(updateRestaurantSchema), 
 catchAsync(updateRestaurant));
router.put("/:id/delivery-status", hasPermission("Restaurants", "Edit"), catchAsync(changeDeliveryStatus));
router.delete("/:id", hasPermission("Restaurants", "Delete"), catchAsync(deleteRestaurant));


// Restaurant Domains
// GET  /api/admin/restaurants/:id/domains
router.get("/:id/domains", validate(restaurantIdParamSchema, "params"), catchAsync(listDomains));

// POST /api/admin/restaurants/:id/domains
router.post("/:id/domains", validate(restaurantIdParamSchema, "params"), validate(addDomainSchema, "body"), catchAsync(addDomain));




export default router;
