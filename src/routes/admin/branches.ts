import { Router } from "express";
import { createBranch, getMyBranches, getBranchById, updateBranch, deleteBranch, updateBranchStatus,getallrestraunt } from "../../controllers/admin/branches";
import { catchAsync } from "../../utils/catchAsync";
const router = Router();

router.post("/", catchAsync(createBranch));
router.get("/:restaurantId", catchAsync(getMyBranches));
router.get("/:restaurantId/:id", catchAsync(getBranchById));
router.put("/:restaurantId/:id", catchAsync(updateBranch));
router.delete("/:restaurantId/:id", catchAsync(deleteBranch));
router.put("/:restaurantId/:id", catchAsync(updateBranchStatus));
router.get("/select", catchAsync(getallrestraunt));
export default router;