import { Router } from "express";
import adminRouter from './admin/index';
import userRouter from './user/index';
import paymentRouter from './payments/index';
import shippingRouter from './shipping/index';
import resolveDomainRouter from './resolveDomain';
import authHandoffRouter from './user/authHandoff';

const route = Router();

// Public: no auth required — resolves custom domain → restaurant slug
route.use('/resolve-domain', resolveDomainRouter);

// Authentication handoff & exchange routes: POST /api/auth/handoff & POST /api/auth/exchange-code
route.use('/auth', authHandoffRouter);

route.use('/superadmin', adminRouter);
route.use('/user', userRouter);
route.use('/payments', paymentRouter);
route.use('/shipping', shippingRouter);

export default route;