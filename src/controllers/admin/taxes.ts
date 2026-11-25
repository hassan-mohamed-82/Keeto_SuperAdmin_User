import { Request, Response } from "express";
import { db } from "../../models/connection";
import { taxes, restaurants } from "../../models/schema";
import { and, count, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound } from "../../Errors";
import { v4 as uuidv4 } from "uuid";
import { TAX_AMOUNT_TYPES, TAX_MODULE_TYPES, TAX_PLATFORM_TYPES } from "../../validation/admin/taxes";

/**
 * Keeto taxes (super admin).
 *  - restaurantIds = [] → applies to ALL restaurants, otherwise only to the selected restaurants.
 *  - source = "keeto" → tells the tax is from Keeto, not from the restaurant.
 *  - taxType is ALWAYS "exclude" → calculated and added to the order total.
 *  - Only active taxes are calculated at checkout.
 */

const keetoScope = eq(taxes.source, "keeto");

type TaxRow = typeof taxes.$inferSelect;

const toIds = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === "string" && v.trim()) {
        try {
            const parsed = JSON.parse(v);
            return Array.isArray(parsed) ? parsed.map(String) : [];
        } catch {
            return [];
        }
    }
    return [];
};

/** Adds restaurant names and formats the Keeto taxes. */
const formatTaxes = async (rows: TaxRow[]) => {
    const allIds = Array.from(new Set(rows.flatMap((t) => toIds(t.restaurantIds))));
    const list = allIds.length
        ? await db
            .select({ id: restaurants.id, name: restaurants.name, nameAr: restaurants.nameAr })
            .from(restaurants)
            .where(inArray(restaurants.id, allIds))
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
            taxType: "exclude" as const,
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

const findKeetoTax = async (id: string) => {
    const [row] = await db.select().from(taxes).where(and(eq(taxes.id, id), keetoScope)).limit(1);
    if (!row) throw new NotFound("Tax not found");
    return row;
};

const formatOne = async (id: string) => (await formatTaxes([await findKeetoTax(id)]))[0];

/** Removes duplicates and checks that every selected restaurant exists. */
const validateRestaurantIds = async (ids: string[]): Promise<string[]> => {
    const unique = Array.from(new Set(ids));
    if (unique.length === 0) return [];
    const found = await db.select({ id: restaurants.id }).from(restaurants).where(inArray(restaurants.id, unique));
    const foundSet = new Set(found.map((r) => r.id));
    const missing = unique.filter((id) => !foundSet.has(id));
    if (missing.length) throw new BadRequest(`Restaurant(s) not found: ${missing.join(", ")}`);
    return unique;
};

export const createTax = async (req: Request, res: Response) => {
    const { restaurantIds, name, nameAr, nameFr, amount, amountType, modules, moduleType, status } = req.body;
    const finalRestaurantIds = await validateRestaurantIds(restaurantIds || []);

    const id = uuidv4();
    await db.insert(taxes).values({
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

    return SuccessResponse(res, { message: "Tax created successfully", data: await formatOne(id) }, 201);
};

export const getAllTaxes = async (req: Request, res: Response) => {
    const { status, search, restaurantId } = req.query as Record<string, string | undefined>;
    const page = Math.max(1, parseInt(String(req.query.page)) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit)) || 10));
    const isAll = req.query.all === "true";

    const conditions: any[] = [keetoScope];
    // taxes that apply to this restaurant (all-restaurants taxes + taxes that include it)
    if (restaurantId) {
        conditions.push(
            or(
                sql`JSON_LENGTH(${taxes.restaurantIds}) = 0`,
                sql`JSON_CONTAINS(${taxes.restaurantIds}, JSON_QUOTE(${restaurantId}))`
            )
        );
    }
    if (status === "active" || status === "inactive") conditions.push(eq(taxes.status, status));
    if (search && search.trim()) {
        const term = `%${search.trim()}%`;
        conditions.push(or(like(taxes.name, term), like(taxes.nameAr, term), like(taxes.nameFr, term)));
    }
    const where = and(...conditions);

    const baseQuery = db.select().from(taxes).where(where).orderBy(desc(taxes.createdAt));

    const [[{ total }], rows] = await Promise.all([
        db.select({ total: count() }).from(taxes).where(where),
        isAll ? baseQuery : baseQuery.limit(limit).offset((page - 1) * limit),
    ]);

    const totalItems = Number(total || 0);
    return SuccessResponse(res, {
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

export const getTaxOptions = async (_req: Request, res: Response) => {
    const restaurantList = await db
        .select({ id: restaurants.id, name: restaurants.name, nameAr: restaurants.nameAr })
        .from(restaurants);

    return SuccessResponse(res, {
        message: "Tax options fetched successfully",
        data: {
            restaurants: restaurantList,
            amountTypes: TAX_AMOUNT_TYPES,
            modules: TAX_MODULE_TYPES,
            moduleTypes: TAX_PLATFORM_TYPES,
            taxTypes: ["exclude"],
        },
    });
};

export const getTaxById = async (req: Request, res: Response) => {
    return SuccessResponse(res, { message: "Tax fetched successfully", data: await formatOne(req.params.id) });
};

export const updateTax = async (req: Request, res: Response) => {
    const { id } = req.params;
    await findKeetoTax(id);

    const { restaurantIds, name, nameAr, nameFr, amount, amountType, modules, moduleType, status } = req.body;
    const updateData: Partial<typeof taxes.$inferInsert> = {};
    // [] → all restaurants
    if (restaurantIds !== undefined) updateData.restaurantIds = await validateRestaurantIds(restaurantIds);
    if (name !== undefined) updateData.name = name;
    if (nameAr !== undefined) updateData.nameAr = nameAr;
    if (nameFr !== undefined) updateData.nameFr = nameFr;
    if (amount !== undefined) updateData.amount = String(amount);
    if (amountType !== undefined) updateData.amountType = amountType;
    if (modules !== undefined) updateData.modules = modules;
    if (moduleType !== undefined) updateData.moduleType = moduleType;
    if (status !== undefined) updateData.status = status;

    if (Object.keys(updateData).length > 0) {
        await db.update(taxes).set(updateData).where(and(eq(taxes.id, id), keetoScope));
    }

    return SuccessResponse(res, { message: "Tax updated successfully", data: await formatOne(id) });
};

export const toggleTaxStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    const tax = await findKeetoTax(id);
    const newStatus = tax.status === "active" ? "inactive" : "active";
    await db.update(taxes).set({ status: newStatus }).where(and(eq(taxes.id, id), keetoScope));
    return SuccessResponse(res, { message: `Tax status changed to ${newStatus}`, data: { id, status: newStatus } });
};

export const deleteTax = async (req: Request, res: Response) => {
    const { id } = req.params;
    await findKeetoTax(id);
    await db.delete(taxes).where(and(eq(taxes.id, id), keetoScope));
    return SuccessResponse(res, { message: "Tax deleted successfully" });
};
