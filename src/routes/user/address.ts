import {Router} from "express";
import {
    addUserAddress,deleteUserAddress,getUserAddresses,
    updateUserAddress,getZones
} from "../../controllers/user/address";
import { catchAsync } from "../../utils/catchAsync";
const router = Router();

router.get("/zone", catchAsync(getZones));
router.post("/", catchAsync(addUserAddress));
router.get("/", catchAsync(getUserAddresses));
router.delete("/:addressId", catchAsync(deleteUserAddress));
router.put("/:addressId", catchAsync(updateUserAddress));

export default router;