import { Router } from "express";
import AdmiRouter from "./admin";
import { db } from "../../models/connection";
import { admins } from "../../models/schema";
import { eq } from "drizzle-orm";
import authRouter from "./auth";
import RolesRouter from "./roles";
import { authenticated } from "../../middlewares/authenticated";
import { authorizeRoles } from "../../middlewares/authorized";
const router = Router();

router.use("/auth", authRouter);
router.use(authenticated, authorizeRoles("superadmin", "admin"));

router.use("/admin", AdmiRouter);
router.use("/roles", RolesRouter);


export default router;    