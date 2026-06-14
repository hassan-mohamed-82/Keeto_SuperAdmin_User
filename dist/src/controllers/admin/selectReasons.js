"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteReason = exports.updateReason = exports.getReasonById = exports.getAllReasons = exports.createReason = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const uuid_1 = require("uuid");
// ==========================================
// 1. إنشاء سبب جديد (Create)
// ==========================================
const createReason = async (req, res) => {
    const { name, status, type } = req.body;
    if (!name || !type) {
        throw new Errors_1.BadRequest("Reason name and type are required");
    }
    const id = (0, uuid_1.v4)();
    await connection_1.db.insert(schema_1.selectReasons).values({
        id,
        name,
        type,
        // لو مبعتش حالة، الديفولت هيكون active زي ما أنت عامل في الداتا بيز
        status: status || "active",
    });
    const [newReason] = await connection_1.db.select().from(schema_1.selectReasons).where((0, drizzle_orm_1.eq)(schema_1.selectReasons.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: "Reason created successfully",
        data: newReason,
    });
};
exports.createReason = createReason;
// ==========================================
// 2. جلب كل الأسباب (Read All)
// ==========================================
const getAllReasons = async (req, res) => {
    const reasons = await connection_1.db
        .select()
        .from(schema_1.selectReasons)
        .orderBy((0, drizzle_orm_1.desc)(schema_1.selectReasons.createdAt));
    return (0, response_1.SuccessResponse)(res, {
        message: "Reasons fetched successfully",
        data: reasons,
    });
};
exports.getAllReasons = getAllReasons;
// ==========================================
// 3. جلب سبب معين بالـ ID (Read One)
// ==========================================
const getReasonById = async (req, res) => {
    const { id } = req.params;
    const [reason] = await connection_1.db.select().from(schema_1.selectReasons).where((0, drizzle_orm_1.eq)(schema_1.selectReasons.id, id));
    if (!reason) {
        throw new Errors_1.NotFound("Reason not found");
    }
    return (0, response_1.SuccessResponse)(res, {
        data: reason,
    });
};
exports.getReasonById = getReasonById;
// ==========================================
// 4. تعديل السبب (Update Name & Status)
// ==========================================
const updateReason = async (req, res) => {
    const { id } = req.params;
    const { name, status } = req.body;
    const [existing] = await connection_1.db.select().from(schema_1.selectReasons).where((0, drizzle_orm_1.eq)(schema_1.selectReasons.id, id));
    if (!existing) {
        throw new Errors_1.NotFound("Reason not found");
    }
    // تجهيز الداتا اللي هتتحدث بناءً على اللي مبعوت في الـ Body
    const updateData = {};
    if (name)
        updateData.name = name;
    if (status)
        updateData.status = status;
    await connection_1.db.update(schema_1.selectReasons)
        .set(updateData)
        .where((0, drizzle_orm_1.eq)(schema_1.selectReasons.id, id));
    const [updatedReason] = await connection_1.db.select().from(schema_1.selectReasons).where((0, drizzle_orm_1.eq)(schema_1.selectReasons.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: "Reason updated successfully",
        data: updatedReason,
    });
};
exports.updateReason = updateReason;
// ==========================================
// 5. حذف السبب (Delete)
// ==========================================
const deleteReason = async (req, res) => {
    const { id } = req.params;
    const [existing] = await connection_1.db.select().from(schema_1.selectReasons).where((0, drizzle_orm_1.eq)(schema_1.selectReasons.id, id));
    if (!existing) {
        throw new Errors_1.NotFound("Reason not found");
    }
    await connection_1.db.delete(schema_1.selectReasons).where((0, drizzle_orm_1.eq)(schema_1.selectReasons.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: "Reason deleted successfully",
    });
};
exports.deleteReason = deleteReason;
