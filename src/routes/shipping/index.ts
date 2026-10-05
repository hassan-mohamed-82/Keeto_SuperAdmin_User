import { Router } from "express";
import authRouter from "./auth";
import restaurantsRouter from "./restaurants";
import zonesRouter from "./zones";
import deliveryMenRouter from "./deliveryMen";
import ordersRouter from "./orders";

const router = Router();

router.use("/auth", authRouter);
router.use("/restaurants", restaurantsRouter);
router.use("/zones", zonesRouter);
router.use("/delivery-men", deliveryMenRouter);
router.use("/orders", ordersRouter);

export default router;
