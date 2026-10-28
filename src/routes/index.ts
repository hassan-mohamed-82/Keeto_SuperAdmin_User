import { Router } from "express";
import adminRouter from './admin/index';
import userRouter from './user/index';
import paymentRouter from './payments/index';
import shippingRouter from './shipping/index';
import resolveDomainRouter from './resolveDomain';

const route = Router();

// Public: no auth required — resolves custom domain → restaurant slug
route.use('/resolve-domain', resolveDomainRouter);

route.use('/superadmin', adminRouter);
route.use('/user', userRouter);
route.use('/payments', paymentRouter);
route.use('/shipping', shippingRouter);

export default route;