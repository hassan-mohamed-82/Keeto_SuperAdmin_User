import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
    getRestaurantOffers,
    getAllOffers,
    getAllDiscountsWithProducts,
} from "../../controllers/user/offers";
import { validate } from "../../middlewares/validation";
import { optionalAuth } from "../../middlewares/authenticated";
import {
    getRestaurantOffersParamsSchema,
    getRestaurantDiscountsParamsSchema,
} from "../../validation/user/offers";

const router = Router();

// 1. GET /offers — Flat list of active food offers
router.get("/", optionalAuth, catchAsync(getAllOffers));

// 2. GET /offers/restaurant/:restaurantId/offers — Restaurant flat food offers
router.get(
    "/restaurant/:restaurantId/offers",
    catchAsync(getRestaurantOffers)
);

// 3. GET /offers/restaurant/:restaurantId/discounts — Restaurant discounts with products
router.get(
    "/restaurant/:restaurantId/discounts",
    optionalAuth,
    validate(getRestaurantDiscountsParamsSchema, "params"),
    catchAsync(getAllDiscountsWithProducts)
);

export default router;
