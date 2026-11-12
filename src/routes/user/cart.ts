import { Router } from "express";
import {
    addToCart,
    getCart,
    updateCartItem,
    removeCartItem,
    clearCart,
    validateCartPricing,
    sendCartForWeighing,
} from "../../controllers/user/cart";
import { catchAsync } from "../../utils/catchAsync";
import { validate } from "../../middlewares/validation";
import {
    addToCartSchema,
    updateCartItemSchema,
    sendForWeighingSchema,
} from "../../validation/user/cart";

const router = Router();

router.post("/validate-pricing", catchAsync(validateCartPricing));
router.post("/send-for-weighing", validate(sendForWeighingSchema), catchAsync(sendCartForWeighing));
router.post("/", validate(addToCartSchema), catchAsync(addToCart));
router.get("/", catchAsync(getCart));
router.put("/:cartItemId", validate(updateCartItemSchema), catchAsync(updateCartItem));
router.delete("/:cartItemId", catchAsync(removeCartItem));
router.delete("/", catchAsync(clearCart));

export default router;