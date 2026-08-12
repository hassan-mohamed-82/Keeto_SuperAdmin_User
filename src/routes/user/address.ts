import { Router } from "express";
import {
    addUserAddress, deleteUserAddress, getUserAddresses,
    updateUserAddress
} from "../../controllers/user/address";
import { catchAsync } from "../../utils/catchAsync";
const router = Router();

router.post("/", catchAsync(addUserAddress));
router.get("/", catchAsync(getUserAddresses));
router.delete("/:addressId", catchAsync(deleteUserAddress));
router.put("/:addressId", catchAsync(updateUserAddress));

export default router;