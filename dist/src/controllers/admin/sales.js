"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteSales = exports.updateSales = exports.getSalesById = exports.getAllSales = exports.createSales = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const uuid_1 = require("uuid");
// ==========================================
// 1. إنشاء مندوب مبيعات جديد
// ==========================================
const createSales = async (req, res) => {
    const { name, phone, email, points, status } = req.body;
    if (!name)
        throw new Errors_1.BadRequest("Sales name is required");
    const newSalesId = (0, uuid_1.v4)();
    await connection_1.db.insert(schema_1.sales).values({
        id: newSalesId,
        name,
        phone: phone || null,
        email: email || null,
        points: points || 0,
        status: status || "active",
    });
    return (0, response_1.SuccessResponse)(res, {
        message: "Sales representative created successfully",
        data: { id: newSalesId }
    });
};
exports.createSales = createSales;
// ==========================================
// 2. جلب كل موظفين المبيعات (للـ Select Dropdown والجدول)
// ==========================================
const getAllSales = async (req, res) => {
    const allSales = await connection_1.db
        .select()
        .from(schema_1.sales)
        .orderBy((0, drizzle_orm_1.desc)(schema_1.sales.createdAt));
    return (0, response_1.SuccessResponse)(res, {
        message: "Get all sales success",
        data: allSales
    });
};
exports.getAllSales = getAllSales;
// ==========================================
// 3. جلب تفاصيل مندوب معين + المطاعم اللي جابها
// ==========================================
const getSalesById = async (req, res) => {
    const { id } = req.params;
    const [salesRep] = await connection_1.db.select().from(schema_1.sales).where((0, drizzle_orm_1.eq)(schema_1.sales.id, id)).limit(1);
    if (!salesRep)
        throw new Errors_1.NotFound("Sales representative not found");
    // نجيب المطاعم اللي هو سجلها عشان نعرض إنجازاته
    const registeredRestaurants = await connection_1.db
        .select({
        id: schema_1.restaurants.id,
        name: schema_1.restaurants.name,
        type: schema_1.restaurants.type,
        status: schema_1.restaurants.status,
        createdAt: schema_1.restaurants.createdAt,
    })
        .from(schema_1.restaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.salesId, id));
    return (0, response_1.SuccessResponse)(res, {
        message: "Get sales details success",
        data: {
            ...salesRep,
            restaurants: registeredRestaurants
        }
    });
};
exports.getSalesById = getSalesById;
// ==========================================
// 4. تعديل بيانات السيلز (أو تعديل البوينتس)
// ==========================================
const updateSales = async (req, res) => {
    const { id } = req.params;
    const { name, phone, email, points, status } = req.body;
    const [existing] = await connection_1.db.select().from(schema_1.sales).where((0, drizzle_orm_1.eq)(schema_1.sales.id, id)).limit(1);
    if (!existing)
        throw new Errors_1.NotFound("Sales representative not found");
    await connection_1.db.update(schema_1.sales)
        .set({
        name: name ?? existing.name,
        phone: phone !== undefined ? phone : existing.phone,
        email: email !== undefined ? email : existing.email,
        points: points !== undefined ? points : existing.points,
        status: status ?? existing.status,
        updatedAt: new Date()
    })
        .where((0, drizzle_orm_1.eq)(schema_1.sales.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Sales representative updated successfully" });
};
exports.updateSales = updateSales;
// ==========================================
// 5. مسح مندوب مبيعات
// ==========================================
const deleteSales = async (req, res) => {
    const { id } = req.params;
    const [existing] = await connection_1.db.select().from(schema_1.sales).where((0, drizzle_orm_1.eq)(schema_1.sales.id, id)).limit(1);
    if (!existing)
        throw new Errors_1.NotFound("Sales representative not found");
    // تأكد إن المندوب ملوش مطاعم متسجلة باسمه قبل ما تمسحه (أو اعمل set null)
    const linkedRestaurants = await connection_1.db.select({ id: schema_1.restaurants.id }).from(schema_1.restaurants).where((0, drizzle_orm_1.eq)(schema_1.restaurants.salesId, id)).limit(1);
    if (linkedRestaurants.length > 0) {
        throw new Errors_1.BadRequest("Cannot delete this sales rep because they have assigned restaurants. Update the restaurants first.");
    }
    await connection_1.db.delete(schema_1.sales).where((0, drizzle_orm_1.eq)(schema_1.sales.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Sales representative deleted successfully" });
};
exports.deleteSales = deleteSales;
