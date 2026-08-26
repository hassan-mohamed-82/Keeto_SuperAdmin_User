import { Router } from "express";
import { addToCart, getCart, updateCartItem, removeCartItem, clearCart, validateCartPricing } from "../../controllers/user/cart";
import { catchAsync } from "../../utils/catchAsync";
const router = Router();

router.post("/validate-pricing", catchAsync(validateCartPricing));
router.post("/", catchAsync(addToCart));
router.get("/", catchAsync(getCart));
router.put("/:cartItemId", catchAsync(updateCartItem));
router.delete("/:cartItemId", catchAsync(removeCartItem));
router.delete("/", catchAsync(clearCart));

export default router;