"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPaymentTransactionDetails = exports.getPaymentTransactions = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
/**
 * Controller: Get Payment Transactions (Audit & Debugging Failed / Succeeded Payments)
 * GET /admin/payment-transactions
 */
const getPaymentTransactions = async (req, res) => {
    const { orderId, orderNumber, restaurantId, gateway, status, page = "1", limit = "20" } = req.query;
    const pageNum = Math.max(1, parseInt(page || "1", 10));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit || "20", 10)));
    const offset = (pageNum - 1) * limitNum;
    const conditions = [];
    if (orderId) {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.paymentTransactions.orderId, orderId));
    }
    if (orderNumber) {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.paymentTransactions.orderNumber, orderNumber));
    }
    if (restaurantId) {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.paymentTransactions.restaurantId, restaurantId));
    }
    if (gateway) {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.paymentTransactions.gateway, gateway));
    }
    if (status) {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.paymentTransactions.status, status));
    }
    const whereClause = conditions.length > 0 ? (0, drizzle_orm_1.and)(...conditions) : undefined;
    const [transactions, [{ total }]] = await Promise.all([
        connection_1.db
            .select({
            id: schema_1.paymentTransactions.id,
            orderId: schema_1.paymentTransactions.orderId,
            orderNumber: schema_1.paymentTransactions.orderNumber,
            userId: schema_1.paymentTransactions.userId,
            userName: schema_1.users.name,
            userPhone: schema_1.users.phone,
            restaurantId: schema_1.paymentTransactions.restaurantId,
            restaurantName: schema_1.restaurants.name,
            gateway: schema_1.paymentTransactions.gateway,
            transactionId: schema_1.paymentTransactions.transactionId,
            gatewayOrderId: schema_1.paymentTransactions.gatewayOrderId,
            amount: schema_1.paymentTransactions.amount,
            currency: schema_1.paymentTransactions.currency,
            status: schema_1.paymentTransactions.status,
            failureReason: schema_1.paymentTransactions.failureReason,
            rawResponse: schema_1.paymentTransactions.rawResponse,
            createdAt: schema_1.paymentTransactions.createdAt,
            updatedAt: schema_1.paymentTransactions.updatedAt,
        })
            .from(schema_1.paymentTransactions)
            .leftJoin(schema_1.users, (0, drizzle_orm_1.eq)(schema_1.paymentTransactions.userId, schema_1.users.id))
            .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.paymentTransactions.restaurantId, schema_1.restaurants.id))
            .where(whereClause)
            .orderBy((0, drizzle_orm_1.desc)(schema_1.paymentTransactions.createdAt))
            .limit(limitNum)
            .offset(offset),
        connection_1.db
            .select({ total: (0, drizzle_orm_1.sql) `count(*)` })
            .from(schema_1.paymentTransactions)
            .where(whereClause),
    ]);
    return (0, response_1.SuccessResponse)(res, {
        data: transactions,
        pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum),
        },
    });
};
exports.getPaymentTransactions = getPaymentTransactions;
/**
 * Controller: Get Single Payment Transaction Details
 * GET /admin/payment-transactions/:id
 */
const getPaymentTransactionDetails = async (req, res) => {
    const { id } = req.params;
    const [record] = await connection_1.db
        .select({
        id: schema_1.paymentTransactions.id,
        orderId: schema_1.paymentTransactions.orderId,
        orderNumber: schema_1.paymentTransactions.orderNumber,
        userId: schema_1.paymentTransactions.userId,
        userName: schema_1.users.name,
        userPhone: schema_1.users.phone,
        userEmail: schema_1.users.email,
        restaurantId: schema_1.paymentTransactions.restaurantId,
        restaurantName: schema_1.restaurants.name,
        gateway: schema_1.paymentTransactions.gateway,
        transactionId: schema_1.paymentTransactions.transactionId,
        gatewayOrderId: schema_1.paymentTransactions.gatewayOrderId,
        amount: schema_1.paymentTransactions.amount,
        currency: schema_1.paymentTransactions.currency,
        status: schema_1.paymentTransactions.status,
        failureReason: schema_1.paymentTransactions.failureReason,
        rawResponse: schema_1.paymentTransactions.rawResponse,
        createdAt: schema_1.paymentTransactions.createdAt,
        updatedAt: schema_1.paymentTransactions.updatedAt,
    })
        .from(schema_1.paymentTransactions)
        .leftJoin(schema_1.users, (0, drizzle_orm_1.eq)(schema_1.paymentTransactions.userId, schema_1.users.id))
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.paymentTransactions.restaurantId, schema_1.restaurants.id))
        .where((0, drizzle_orm_1.eq)(schema_1.paymentTransactions.id, id))
        .limit(1);
    if (!record) {
        throw new Errors_1.NotFound("Payment transaction record not found.");
    }
    return (0, response_1.SuccessResponse)(res, { data: record });
};
exports.getPaymentTransactionDetails = getPaymentTransactionDetails;
