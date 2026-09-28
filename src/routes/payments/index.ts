import { Router } from "express";
import kashierRouter from './kashierpayment';
import paymobRouter from './paymobpayment';
import geideaRouter from './geideapayment';
const route = Router();

route.use('/kashier', kashierRouter);
route.use('/paymob', paymobRouter);
route.use('/geidea', geideaRouter);

export default route;