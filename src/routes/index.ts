import { Router } from "express";
import adminRouter from './admin/index';
import userRouter from './user/index';

const route = Router();

route.use('/superadmin', adminRouter);
route.use('/user', userRouter);


export default route;