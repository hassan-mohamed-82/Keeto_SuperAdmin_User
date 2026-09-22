import { Router } from "express";
import kashierRouter from './kashierpayment';
import paymobRouter from './paymobpayment';
const route = Router();

route.use('/kashier', kashierRouter);
route.use('/paymob', paymobRouter);

export default route;