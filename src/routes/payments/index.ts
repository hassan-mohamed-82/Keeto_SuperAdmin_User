import { Router } from "express";
import kashierRouter from './kashierpayment';
const route = Router();

route.use('/kashier', kashierRouter);

export default route;