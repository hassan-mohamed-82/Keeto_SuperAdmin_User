import { and, eq, inArray, isNull, or, SQL } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { foodPricingOverrides, variantPricingOverrides } from "../models/schema/admin/channelPricing";

export type ServiceModule = "takeaway" | "dine_in" | "delivery";

export function overrideRank(row: { branchId: string | null; serviceModule: string | null }): number {
    return (row.branchId ? 2 : 0) + (row.serviceModule ? 1 : 0);
}

// ✅ FIX: the generic constraint was missing `price`, so TypeScript only
// guaranteed the shape { branchId, serviceModule, status? } on the return
// value — any caller reading `.price` off the result (pricing.helper.ts,
// twice: once for the food override, once for the variant override) failed
// with "Property 'price' does not exist on type ...". Adding `price` to the
// constraint means every T that can be passed in must have it, so the
// returned T keeps it too.
export function pickBestOverride<
    T extends {
        branchId: string | null;
        serviceModule: string | null;
        status?: string;
        price: string | number | null;
    }
>(rows: T[]): T | undefined {
    const active = rows.filter((r) => r.status !== "inactive");
    if (active.length === 0) return undefined;
    return [...active].sort((a, b) => overrideRank(b) - overrideRank(a))[0];
}

export function cascadeOverrideCondition(
    table: typeof foodPricingOverrides | typeof variantPricingOverrides,
    branchId: string,
    serviceModule?: ServiceModule
): SQL | undefined {
    const candidates = [
        and(eq(table.branchId, branchId), isNull(table.serviceModule)),
    ];
    if (serviceModule) {
        candidates.push(
            and(eq(table.branchId, branchId), eq(table.serviceModule, serviceModule)),
            and(isNull(table.branchId), eq(table.serviceModule, serviceModule))
        );
    }
    return or(...candidates);
}

export function overrideKeyWhere(
    table: typeof foodPricingOverrides | typeof variantPricingOverrides,
    branchId: string | null,
    serviceModule: ServiceModule | null
) {
    return and(
        branchId ? eq(table.branchId, branchId) : isNull(table.branchId),
        serviceModule ? eq(table.serviceModule, serviceModule) : isNull(table.serviceModule)
    );
}

export async function upsertFoodPricingOverride(
    tx: any,
    input: {
        foodId: string;
        branchId: string | null;
        serviceModule: ServiceModule | null;
        price: string;
        status?: "active" | "inactive";
    }
) {
    const statusVal: "active" | "inactive" = input.status === "inactive" ? "inactive" : "active";
    const whereClause = and(
        eq(foodPricingOverrides.foodId, input.foodId),
        overrideKeyWhere(foodPricingOverrides, input.branchId, input.serviceModule)
    );

    const [existing] = await tx
        .select({ id: foodPricingOverrides.id })
        .from(foodPricingOverrides)
        .where(whereClause)
        .limit(1);

    if (existing) {
        await tx
            .update(foodPricingOverrides)
            .set({ price: input.price, status: statusVal, updatedAt: new Date() })
            .where(eq(foodPricingOverrides.id, existing.id));
        return existing.id as string;
    }

    const id = uuidv4();
    await tx.insert(foodPricingOverrides).values({
        id,
        foodId: input.foodId,
        branchId: input.branchId,
        serviceModule: input.serviceModule,
        price: input.price,
        status: statusVal,
    });
    return id;
}

export async function upsertVariantPricingOverride(
    tx: any,
    input: {
        variantId: string;
        branchId: string | null;
        serviceModule: ServiceModule | null;
        price: string;
        status?: "active" | "inactive";
    }
) {
    const statusVal: "active" | "inactive" = input.status === "inactive" ? "inactive" : "active";
    const whereClause = and(
        eq(variantPricingOverrides.variantId, input.variantId),
        overrideKeyWhere(variantPricingOverrides, input.branchId, input.serviceModule)
    );

    const [existing] = await tx
        .select({ id: variantPricingOverrides.id })
        .from(variantPricingOverrides)
        .where(whereClause)
        .limit(1);

    if (existing) {
        await tx
            .update(variantPricingOverrides)
            .set({ price: input.price, status: statusVal, updatedAt: new Date() })
            .where(eq(variantPricingOverrides.id, existing.id));
        return existing.id as string;
    }

    const id = uuidv4();
    await tx.insert(variantPricingOverrides).values({
        id,
        variantId: input.variantId,
        branchId: input.branchId,
        serviceModule: input.serviceModule,
        price: input.price,
        status: statusVal,
    });
    return id;
}

export async function fetchFoodOverrides(
    dbOrTx: any,
    foodId: string,
    branchId: string,
    serviceModule?: ServiceModule
) {
    return dbOrTx
        .select({
            id: foodPricingOverrides.id,
            branchId: foodPricingOverrides.branchId,
            serviceModule: foodPricingOverrides.serviceModule,
            price: foodPricingOverrides.price,
            status: foodPricingOverrides.status,
        })
        .from(foodPricingOverrides)
        .where(
            and(
                eq(foodPricingOverrides.foodId, foodId),
                eq(foodPricingOverrides.status, "active"),
                cascadeOverrideCondition(foodPricingOverrides, branchId, serviceModule)
            )
        );
}

export async function fetchVariantOverrides(
    dbOrTx: any,
    variantIds: string[],
    branchId: string,
    serviceModule?: ServiceModule
) {
    if (variantIds.length === 0) return [];
    return dbOrTx
        .select({
            variantId: variantPricingOverrides.variantId,
            branchId: variantPricingOverrides.branchId,
            serviceModule: variantPricingOverrides.serviceModule,
            price: variantPricingOverrides.price,
            status: variantPricingOverrides.status,
        })
        .from(variantPricingOverrides)
        .where(
            and(
                inArray(variantPricingOverrides.variantId, variantIds),
                eq(variantPricingOverrides.status, "active"),
                cascadeOverrideCondition(variantPricingOverrides, branchId, serviceModule)
            )
        );
}

export function parsePrice(value: string | number | null | undefined, fallback = 0): number {
    if (value === null || value === undefined || value === "") return fallback;
    const n = parseFloat(String(value));
    return Number.isFinite(n) ? n : fallback;
}