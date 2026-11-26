"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteTax = exports.toggleTaxStatus = exports.updateTax = exports.getTaxById = exports.getTaxOptions = exports.getAllTaxes = exports.createTax = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const uuid_1 = require("uuid");
const taxes_1 = require("../../validation/admin/taxes");
/**
 * Keeto taxes (super admin).
 *  - restaurantIds = [] → applies to ALL restaurants, otherwise only to the selected restaurants.
 *  - source = "keeto" → tells the tax is from Keeto, not from the restaurant.
 *  - taxType is ALWAYS "exclude" → calculated and added to the order total.
 *  - Only active taxes are calculated at checkout.
 */
const keetoScope = (0, drizzle_orm_1.eq)(schema_1.taxes.source, "keeto");
const toIds = (v) => {
    if (Array.isArray(v))
        return v.map(String);
    if (typeof v === "string" && v.trim()) {
        try {
            const parsed = JSON.parse(v);
            return Array.isArray(parsed) ? parsed.map(String) : [];
        }
        catch {
            return [];
        }
    }
    return [];
};
/** Adds restaurant names and formats the Keeto taxes. */
const formatTaxes = async (rows) => {
    const allIds = Array.from(new Set(rows.flatMap((t) => toIds(t.restaurantIds))));
    const list = allIds.length
        ? await connection_1.db
            .select({ id: schema_1.restaurants.id, name: schema_1.restaurants.name, nameAr: schema_1.restaurants.nameAr })
            .from(schema_1.restaurants)
            .where((0, drizzle_orm_1.inArray)(schema_1.restaurants.id, allIds))
        : [];
    const map = new Map(list.map((r) => [r.id, r]));
    return rows.map((t) => {
        const restaurantIds = toIds(t.restaurantIds);
        return {
            id: t.id,
            name: t.name,
            nameAr: t.nameAr,
            nameFr: t.nameFr,
            amount: Number(t.amount),
            amountType: t.amountType,
            source: t.source,
            taxType: "exclude",
            appliesToAllRestaurants: restaurantIds.length === 0,
            restaurantIds,
            restaurants: restaurantIds.map((id) => map.get(id)).filter(Boolean),
            modules: t.modules,
            moduleType: t.moduleType,
            status: t.status,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
        };
    });
};
const findKeetoTax = async (id) => {
    const [row] = await connection_1.db.select().from(schema_1.taxes).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taxes.id, id), keetoScope)).limit(1);
    if (!row)
        throw new Errors_1.NotFound("Tax not found");
    return row;
};
const formatOne = async (id) => (await formatTaxes([await findKeetoTax(id)]))[0];
/** Removes duplicates and checks that every selected restaurant exists. */
const validateRestaurantIds = async (ids) => {
    const unique = Array.from(new Set(ids));
    if (unique.length === 0)
        return [];
    const found = await connection_1.db.select({ id: schema_1.restaurants.id }).from(schema_1.restaurants).where((0, drizzle_orm_1.inArray)(schema_1.restaurants.id, unique));
    const foundSet = new Set(found.map((r) => r.id));
    const missing = unique.filter((id) => !foundSet.has(id));
    if (missing.length)
        throw new Errors_1.BadRequest(`Restaurant(s) not found: ${missing.join(", ")}`);
    return unique;
};
const createTax = async (req, res) => {
    const { restaurantIds, name, nameAr, nameFr, amount, amountType, modules, moduleType, status } = req.body;
    const finalRestaurantIds = await validateRestaurantIds(restaurantIds || []);
    const id = (0, uuid_1.v4)();
    await connection_1.db.insert(schema_1.taxes).values({
        id,
        restaurantId: null,
        restaurantIds: finalRestaurantIds,
        source: "keeto",
        name,
        nameAr: nameAr || null,
        nameFr: nameFr || null,
        amount: String(amount),
        amountType,
        taxType: "exclude",
        modules,
        moduleType,
        foodIds: [],
        branchIds: [],
        status,
    });
    return (0, response_1.SuccessResponse)(res, { message: "Tax created successfully", data: await formatOne(id) }, 201);
};
exports.createTax = createTax;
const getAllTaxes = async (req, res) => {
    const { status, search, restaurantId } = req.query;
    const page = Math.max(1, parseInt(String(req.query.page)) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit)) || 10));
    const isAll = req.query.all === "true";
    const conditions = [keetoScope];
    // taxes that apply to this restaurant (all-restaurants taxes + taxes that include it)
    if (restaurantId) {
        conditions.push((0, drizzle_orm_1.or)((0, drizzle_orm_1.sql) `JSON_LENGTH(${schema_1.taxes.restaurantIds}) = 0`, (0, drizzle_orm_1.sql) `JSON_CONTAINS(${schema_1.taxes.restaurantIds}, JSON_QUOTE(${restaurantId}))`));
    }
    if (status === "active" || status === "inactive")
        conditions.push((0, drizzle_orm_1.eq)(schema_1.taxes.status, status));
    if (search && search.trim()) {
        const term = `%${search.trim()}%`;
        conditions.push((0, drizzle_orm_1.or)((0, drizzle_orm_1.like)(schema_1.taxes.name, term), (0, drizzle_orm_1.like)(schema_1.taxes.nameAr, term), (0, drizzle_orm_1.like)(schema_1.taxes.nameFr, term)));
    }
    const where = (0, drizzle_orm_1.and)(...conditions);
    const baseQuery = connection_1.db.select().from(schema_1.taxes).where(where).orderBy((0, drizzle_orm_1.desc)(schema_1.taxes.createdAt));
    const [[{ total }], rows] = await Promise.all([
        connection_1.db.select({ total: (0, drizzle_orm_1.count)() }).from(schema_1.taxes).where(where),
        isAll ? baseQuery : baseQuery.limit(limit).offset((page - 1) * limit),
    ]);
    const totalItems = Number(total || 0);
    return (0, response_1.SuccessResponse)(res, {
        message: "Taxes fetched successfully",
        data: await formatTaxes(rows),
        pagination: {
            page: isAll ? 1 : page,
            limit: isAll ? totalItems : limit,
            totalItems,
            totalPages: isAll ? 1 : Math.ceil(totalItems / limit),
        },
    });
};
exports.getAllTaxes = getAllTaxes;
const getTaxOptions = async (_req, res) => {
    const restaurantList = await connection_1.db
        .select({ id: schema_1.restaurants.id, name: schema_1.restaurants.name, nameAr: schema_1.restaurants.nameAr })
        .from(schema_1.restaurants);
    return (0, response_1.SuccessResponse)(res, {
        message: "Tax options fetched successfully",
        data: {
            restaurants: restaurantList,
            amountTypes: taxes_1.TAX_AMOUNT_TYPES,
            modules: taxes_1.TAX_MODULE_TYPES,
            moduleTypes: taxes_1.TAX_PLATFORM_TYPES,
            taxTypes: ["exclude"],
        },
    });
};
exports.getTaxOptions = getTaxOptions;
const getTaxById = async (req, res) => {
    return (0, response_1.SuccessResponse)(res, { message: "Tax fetched successfully", data: await formatOne(req.params.id) });
};
exports.getTaxById = getTaxById;
const updateTax = async (req, res) => {
    const { id } = req.params;
    await findKeetoTax(id);
    const { restaurantIds, name, nameAr, nameFr, amount, amountType, modules, moduleType, status } = req.body;
    const updateData = {};
    // [] → all restaurants
    if (restaurantIds !== undefined)
        updateData.restaurantIds = await validateRestaurantIds(restaurantIds);
    if (name !== undefined)
        updateData.name = name;
    if (nameAr !== undefined)
        updateData.nameAr = nameAr;
    if (nameFr !== undefined)
        updateData.nameFr = nameFr;
    if (amount !== undefined)
        updateData.amount = String(amount);
    if (amountType !== undefined)
        updateData.amountType = amountType;
    if (modules !== undefined)
        updateData.modules = modules;
    if (moduleType !== undefined)
        updateData.moduleType = moduleType;
    if (status !== undefined)
        updateData.status = status;
    if (Object.keys(updateData).length > 0) {
        await connection_1.db.update(schema_1.taxes).set(updateData).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taxes.id, id), keetoScope));
    }
    return (0, response_1.SuccessResponse)(res, { message: "Tax updated successfully", data: await formatOne(id) });
};
exports.updateTax = updateTax;
const toggleTaxStatus = async (req, res) => {
    const { id } = req.params;
    const tax = await findKeetoTax(id);
    const newStatus = tax.status === "active" ? "inactive" : "active";
    await connection_1.db.update(schema_1.taxes).set({ status: newStatus }).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taxes.id, id), keetoScope));
    return (0, response_1.SuccessResponse)(res, { message: `Tax status changed to ${newStatus}`, data: { id, status: newStatus } });
};
exports.toggleTaxStatus = toggleTaxStatus;
const deleteTax = async (req, res) => {
    const { id } = req.params;
    await findKeetoTax(id);
    await connection_1.db.delete(schema_1.taxes).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taxes.id, id), keetoScope));
    return (0, response_1.SuccessResponse)(res, { message: "Tax deleted successfully" });
};
exports.deleteTax = deleteTax;
