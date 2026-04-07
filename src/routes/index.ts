import { Router } from "express";
import adminRouter from './admin/index';

const route = Router();

route.use('/superadmin', adminRouter);


export default route;