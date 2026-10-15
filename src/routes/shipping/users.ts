import { Router } from "express";
import {
    getCompanyUsers,
    createCompanyUser,
    updateCompanyUser,
    deleteCompanyUser,
    getUserById,
    toggleCompanyUserStatus,
} from "../../controllers/shipping/users";
import { authenticated } from "../../middlewares/authenticated";
import { requireShippingCompany } from "../../middlewares/shippingAuth";
import { validate } from "../../middlewares/validation";
import {
    createCompanyUserSchema,
    updateCompanyUserSchema,
    toggleCompanyUserStatusSchema,
} from "../../validation/shipping/auth";

const router = Router();

// All user management routes require authenticated shipping company admin
router.use(authenticated, requireShippingCompany("admin"));

router.get("/", getCompanyUsers);
router.post("/", validate(createCompanyUserSchema), createCompanyUser);
router.get("/:id", getUserById);
router.put("/:id", validate(updateCompanyUserSchema), updateCompanyUser);
router.put("/:id/toggle-status", validate(toggleCompanyUserStatusSchema), toggleCompanyUserStatus);
router.delete("/:id", deleteCompanyUser);

export default router;
