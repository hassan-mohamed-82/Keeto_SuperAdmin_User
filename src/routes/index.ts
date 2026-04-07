import { Router } from "express";
import adminRouter from './admin/index';

const route = Router();

route.use('/admin', adminRouter);


export default route;