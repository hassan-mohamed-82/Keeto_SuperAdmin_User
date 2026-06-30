import { Router } from "express";
import { createBranch, getMyBranches, getBranchById, updateBranch, deleteBranch, updateBranchStatus,getallrestraunt } from "../../controllers/admin/branches";
import { catchAsync } from "../../utils/catchAsync";
const router = Router();

router.post("/", catchAsync(createBranch));
router.get("/", catchAsync(getMyBranches));
router.get("/:id", catchAsync(getBranchById));
router.put("/:id", catchAsync(updateBranch));
router.delete("/:id", catchAsync(deleteBranch));
router.put("/status/:id", catchAsync(updateBranchStatus));
router.get("/select", catchAsync(getallrestraunt));
export default router;