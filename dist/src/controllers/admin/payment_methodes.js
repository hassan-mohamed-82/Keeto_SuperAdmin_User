"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatepaymentmethodstatus = exports.getPaymentMethods = exports.createPaymentMethod = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const createPaymentMethod = async (req, res) => {
    const { name, nameAr, isActive } = req.body;
    if (!name || !nameAr) {
        throw new Errors_1.BadRequest("Missing required fields");
    }
    const [paymentMethod] = await connection_1.db.insert(schema_1.paymentMethods).values({
        name,
        nameAr,
        isActive: isActive || true,
    });
    return (0, response_1.SuccessResponse)(res, { data: paymentMethod });
};
exports.createPaymentMethod = createPaymentMethod;
const getPaymentMethods = async (req, res) => {
    const paymentMethod = await connection_1.db.select().from(schema_1.paymentMethods);
    return (0, response_1.SuccessResponse)(res, { data: paymentMethod });
};
exports.getPaymentMethods = getPaymentMethods;
const updatepaymentmethodstatus = async (req, res) => {
    const { id } = req.params;
    const { isActive } = req.body;
    if (!isActive) {
        throw new Errors_1.BadRequest("Missing required fields");
    }
    const [paymentMethod] = await connection_1.db.update(schema_1.paymentMethods).set({
        isActive: isActive || true,
    }).where((0, drizzle_orm_1.eq)(schema_1.paymentMethods.id, id));
    return (0, response_1.SuccessResponse)(res, { data: paymentMethod });
};
exports.updatepaymentmethodstatus = updatepaymentmethodstatus;
