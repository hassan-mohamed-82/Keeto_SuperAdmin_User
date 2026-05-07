import { Router } from "express";
import { addToCart, getCart, updateCartItem, removeCartItem, clearCart } from "../../controllers/user/cart";
import { catchAsync } from "../../utils/catchAsync";
const router = Router();

router.post("/", catchAsync(addToCart));
router.get("/", catchAsync(getCart));
router.put("/:cartItemId", catchAsync(updateCartItem));
router.delete("/:cartItemId", catchAsync(removeCartItem));
router.delete("/", catchAsync(clearCart));

export default router;