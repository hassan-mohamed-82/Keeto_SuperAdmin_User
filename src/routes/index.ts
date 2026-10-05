import { Router } from "express";
import adminRouter from './admin/index';
import userRouter from './user/index';
import paymentRouter from './payments/index';
import shippingRouter from './shipping/index';

const route = Router();

route.use('/superadmin', adminRouter);
route.use('/user', userRouter);
route.use('/payments', paymentRouter);
route.use('/shipping', shippingRouter);

export default route;