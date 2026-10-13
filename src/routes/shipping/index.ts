import { Router } from "express";
import authRouter from "./auth";
import usersRouter from "./users";
import restaurantsRouter from "./restaurants";
import zonesRouter from "./zones";
import deliveryMenRouter from "./deliveryMen";
import ordersRouter from "./orders";
import reportsRouter from "./reports";

const router = Router();

router.use("/auth", authRouter);
router.use("/users", usersRouter);
router.use("/restaurants", restaurantsRouter);
router.use("/zones", zonesRouter);
router.use("/delivery-men", deliveryMenRouter);
router.use("/orders", ordersRouter);
router.use("/reports", reportsRouter);

export default router;
