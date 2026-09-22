"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.overrideRank = overrideRank;
exports.pickBestOverride = pickBestOverride;
exports.cascadeOverrideCondition = cascadeOverrideCondition;
exports.overrideKeyWhere = overrideKeyWhere;
exports.upsertFoodPricingOverride = upsertFoodPricingOverride;
exports.upsertVariantPricingOverride = upsertVariantPricingOverride;
exports.fetchFoodOverrides = fetchFoodOverrides;
exports.fetchVariantOverrides = fetchVariantOverrides;
exports.parsePrice = parsePrice;
const drizzle_orm_1 = require("drizzle-orm");
const uuid_1 = require("uuid");
const channelPricing_1 = require("../models/schema/admin/channelPricing");
function overrideRank(row) {
    return (row.branchId ? 2 : 0) + (row.serviceModule ? 1 : 0);
}
// ✅ FIX: the generic constraint was missing `price`, so TypeScript only
// guaranteed the shape { branchId, serviceModule, status? } on the return
// value — any caller reading `.price` off the result (pricing.helper.ts,
// twice: once for the food override, once for the variant override) failed
// with "Property 'price' does not exist on type ...". Adding `price` to the
// constraint means every T that can be passed in must have it, so the
// returned T keeps it too.
function pickBestOverride(rows) {
    const active = rows.filter((r) => r.status !== "inactive");
    if (active.length === 0)
        return undefined;
    return [...active].sort((a, b) => overrideRank(b) - overrideRank(a))[0];
}
function cascadeOverrideCondition(table, branchId, serviceModule) {
    const candidates = [];
    if (branchId && serviceModule) {
        candidates.push((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(table.branchId, branchId), (0, drizzle_orm_1.eq)(table.serviceModule, serviceModule)), (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(table.branchId, branchId), (0, drizzle_orm_1.isNull)(table.serviceModule)), (0, drizzle_orm_1.and)((0, drizzle_orm_1.isNull)(table.branchId), (0, drizzle_orm_1.eq)(table.serviceModule, serviceModule)), (0, drizzle_orm_1.and)((0, drizzle_orm_1.isNull)(table.branchId), (0, drizzle_orm_1.isNull)(table.serviceModule)));
    }
    else if (branchId) {
        candidates.push((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(table.branchId, branchId), (0, drizzle_orm_1.isNull)(table.serviceModule)), (0, drizzle_orm_1.and)((0, drizzle_orm_1.isNull)(table.branchId), (0, drizzle_orm_1.isNull)(table.serviceModule)));
    }
    else if (serviceModule) {
        candidates.push((0, drizzle_orm_1.and)((0, drizzle_orm_1.isNull)(table.branchId), (0, drizzle_orm_1.eq)(table.serviceModule, serviceModule)), (0, drizzle_orm_1.and)((0, drizzle_orm_1.isNull)(table.branchId), (0, drizzle_orm_1.isNull)(table.serviceModule)));
    }
    else {
        candidates.push((0, drizzle_orm_1.and)((0, drizzle_orm_1.isNull)(table.branchId), (0, drizzle_orm_1.isNull)(table.serviceModule)));
    }
    const validCandidates = candidates.filter(Boolean);
    return validCandidates.length > 0 ? (0, drizzle_orm_1.or)(...validCandidates) : undefined;
}
function overrideKeyWhere(table, branchId, serviceModule) {
    return (0, drizzle_orm_1.and)(branchId ? (0, drizzle_orm_1.eq)(table.branchId, branchId) : (0, drizzle_orm_1.isNull)(table.branchId), serviceModule ? (0, drizzle_orm_1.eq)(table.serviceModule, serviceModule) : (0, drizzle_orm_1.isNull)(table.serviceModule));
}
async function upsertFoodPricingOverride(tx, input) {
    const statusVal = input.status === "inactive" ? "inactive" : "active";
    const whereClause = (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(channelPricing_1.foodPricingOverrides.foodId, input.foodId), overrideKeyWhere(channelPricing_1.foodPricingOverrides, input.branchId, input.serviceModule));
    const [existing] = await tx
        .select({ id: channelPricing_1.foodPricingOverrides.id })
        .from(channelPricing_1.foodPricingOverrides)
        .where(whereClause)
        .limit(1);
    if (existing) {
        await tx
            .update(channelPricing_1.foodPricingOverrides)
            .set({ price: input.price, status: statusVal, updatedAt: new Date() })
            .where((0, drizzle_orm_1.eq)(channelPricing_1.foodPricingOverrides.id, existing.id));
        return existing.id;
    }
    const id = (0, uuid_1.v4)();
    await tx.insert(channelPricing_1.foodPricingOverrides).values({
        id,
        foodId: input.foodId,
        branchId: input.branchId,
        serviceModule: input.serviceModule,
        price: input.price,
        status: statusVal,
    });
    return id;
}
async function upsertVariantPricingOverride(tx, input) {
    const statusVal = input.status === "inactive" ? "inactive" : "active";
    const whereClause = (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(channelPricing_1.variantPricingOverrides.variantId, input.variantId), overrideKeyWhere(channelPricing_1.variantPricingOverrides, input.branchId, input.serviceModule));
    const [existing] = await tx
        .select({ id: channelPricing_1.variantPricingOverrides.id })
        .from(channelPricing_1.variantPricingOverrides)
        .where(whereClause)
        .limit(1);
    if (existing) {
        await tx
            .update(channelPricing_1.variantPricingOverrides)
            .set({ price: input.price, status: statusVal, updatedAt: new Date() })
            .where((0, drizzle_orm_1.eq)(channelPricing_1.variantPricingOverrides.id, existing.id));
        return existing.id;
    }
    const id = (0, uuid_1.v4)();
    await tx.insert(channelPricing_1.variantPricingOverrides).values({
        id,
        variantId: input.variantId,
        branchId: input.branchId,
        serviceModule: input.serviceModule,
        price: input.price,
        status: statusVal,
    });
    return id;
}
async function fetchFoodOverrides(dbOrTx, foodId, branchId, serviceModule) {
    const overrideCond = cascadeOverrideCondition(channelPricing_1.foodPricingOverrides, branchId, serviceModule);
    const conditions = [
        (0, drizzle_orm_1.eq)(channelPricing_1.foodPricingOverrides.foodId, foodId),
        (0, drizzle_orm_1.eq)(channelPricing_1.foodPricingOverrides.status, "active"),
    ];
    if (overrideCond) {
        conditions.push(overrideCond);
    }
    return dbOrTx
        .select({
        id: channelPricing_1.foodPricingOverrides.id,
        branchId: channelPricing_1.foodPricingOverrides.branchId,
        serviceModule: channelPricing_1.foodPricingOverrides.serviceModule,
        price: channelPricing_1.foodPricingOverrides.price,
        status: channelPricing_1.foodPricingOverrides.status,
    })
        .from(channelPricing_1.foodPricingOverrides)
        .where((0, drizzle_orm_1.and)(...conditions));
}
async function fetchVariantOverrides(dbOrTx, variantIds, branchId, serviceModule) {
    if (variantIds.length === 0)
        return [];
    const overrideCond = cascadeOverrideCondition(channelPricing_1.variantPricingOverrides, branchId, serviceModule);
    const conditions = [
        (0, drizzle_orm_1.inArray)(channelPricing_1.variantPricingOverrides.variantId, variantIds),
        (0, drizzle_orm_1.eq)(channelPricing_1.variantPricingOverrides.status, "active"),
    ];
    if (overrideCond) {
        conditions.push(overrideCond);
    }
    return dbOrTx
        .select({
        variantId: channelPricing_1.variantPricingOverrides.variantId,
        branchId: channelPricing_1.variantPricingOverrides.branchId,
        serviceModule: channelPricing_1.variantPricingOverrides.serviceModule,
        price: channelPricing_1.variantPricingOverrides.price,
        status: channelPricing_1.variantPricingOverrides.status,
    })
        .from(channelPricing_1.variantPricingOverrides)
        .where((0, drizzle_orm_1.and)(...conditions));
}
function parsePrice(value, fallback = 0) {
    if (value === null || value === undefined || value === "")
        return fallback;
    const n = parseFloat(String(value));
    return Number.isFinite(n) ? n : fallback;
}
