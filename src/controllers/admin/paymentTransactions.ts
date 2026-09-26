import { Request, Response } from "express";
import { db } from "../../models/connection";
import { paymentTransactions, restaurants, users, orders } from "../../models/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors";

/**
 * Controller: Get Payment Transactions (Audit & Debugging Failed / Succeeded Payments)
 * GET /admin/payment-transactions
 */
export const getPaymentTransactions = async (req: Request, res: Response) => {
    const {
        orderId,
        orderNumber,
        restaurantId,
        gateway,
        status,
        page = "1",
        limit = "20"
    } = req.query as Record<string, string | undefined>;

    const pageNum = Math.max(1, parseInt(page || "1", 10));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit || "20", 10)));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];

    if (orderId) {
        conditions.push(eq(paymentTransactions.orderId, orderId));
    }
    if (orderNumber) {
        conditions.push(eq(paymentTransactions.orderNumber, orderNumber));
    }
    if (restaurantId) {
        conditions.push(eq(paymentTransactions.restaurantId, restaurantId));
    }
    if (gateway) {
        conditions.push(eq(paymentTransactions.gateway, gateway as any));
    }
    if (status) {
        conditions.push(eq(paymentTransactions.status, status as any));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [transactions, [{ total }]] = await Promise.all([
        db
            .select({
                id: paymentTransactions.id,
                orderId: paymentTransactions.orderId,
                orderNumber: paymentTransactions.orderNumber,
                userId: paymentTransactions.userId,
                userName: users.name,
                userPhone: users.phone,
                restaurantId: paymentTransactions.restaurantId,
                restaurantName: restaurants.name,
                gateway: paymentTransactions.gateway,
                transactionId: paymentTransactions.transactionId,
                gatewayOrderId: paymentTransactions.gatewayOrderId,
                amount: paymentTransactions.amount,
                currency: paymentTransactions.currency,
                status: paymentTransactions.status,
                failureReason: paymentTransactions.failureReason,
                rawResponse: paymentTransactions.rawResponse,
                createdAt: paymentTransactions.createdAt,
                updatedAt: paymentTransactions.updatedAt,
            })
            .from(paymentTransactions)
            .leftJoin(users, eq(paymentTransactions.userId, users.id))
            .leftJoin(restaurants, eq(paymentTransactions.restaurantId, restaurants.id))
            .where(whereClause)
            .orderBy(desc(paymentTransactions.createdAt))
            .limit(limitNum)
            .offset(offset),
        db
            .select({ total: sql<number>`count(*)` })
            .from(paymentTransactions)
            .where(whereClause),
    ]);

    return SuccessResponse(res, {
        data: transactions,
        pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum),
        },
    });
};

/**
 * Controller: Get Single Payment Transaction Details
 * GET /admin/payment-transactions/:id
 */
export const getPaymentTransactionDetails = async (req: Request, res: Response) => {
    const { id } = req.params;

    const [record] = await db
        .select({
            id: paymentTransactions.id,
            orderId: paymentTransactions.orderId,
            orderNumber: paymentTransactions.orderNumber,
            userId: paymentTransactions.userId,
            userName: users.name,
            userPhone: users.phone,
            userEmail: users.email,
            restaurantId: paymentTransactions.restaurantId,
            restaurantName: restaurants.name,
            gateway: paymentTransactions.gateway,
            transactionId: paymentTransactions.transactionId,
            gatewayOrderId: paymentTransactions.gatewayOrderId,
            amount: paymentTransactions.amount,
            currency: paymentTransactions.currency,
            status: paymentTransactions.status,
            failureReason: paymentTransactions.failureReason,
            rawResponse: paymentTransactions.rawResponse,
            createdAt: paymentTransactions.createdAt,
            updatedAt: paymentTransactions.updatedAt,
        })
        .from(paymentTransactions)
        .leftJoin(users, eq(paymentTransactions.userId, users.id))
        .leftJoin(restaurants, eq(paymentTransactions.restaurantId, restaurants.id))
        .where(eq(paymentTransactions.id, id))
        .limit(1);

    if (!record) {
        throw new NotFound("Payment transaction record not found.");
    }

    return SuccessResponse(res, { data: record });
};
