import { Router } from "express";
import adminRouter from './admin/index';
import userRouter from './user/index';
import paymentRouter from './payment';

const route = Router();

route.use('/superadmin', adminRouter);
route.use('/user', userRouter);
route.use('/payments', paymentRouter);

export default route;