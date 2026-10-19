import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { and, count, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";
import { db } from "../../models/connection";
import {
    branches,
    cities,
    cuisines,
    orders,
    restaurantOperations,
    restaurants,
    sales,
} from "../../models/schema";
import type { RestaurantOperationNote as Note } from "../../models/schema";
import { NotFound } from "../../Errors/NotFound";
import { SuccessResponse } from "../../utils/response";
import {
    getRestaurantOperationsQuerySchema,
    updateRestaurantOperationParamsSchema,
    updateRestaurantOperationSchema,
} from "../../validation/admin/restaurantOperations";

type NoteInput = string | { id?: string; text: string };

const parseCuisineIds = (input: unknown): string[] => {
    if (!input) return [];
    if (Array.isArray(input)) {
        return input.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
    }
    if (typeof input === "string") {
        try {
            const parsed = JSON.parse(input);
            if (Array.isArray(parsed)) {
                return parsed.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
            }
        } catch {
            const uuidRegex = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
            const matches = input.match(uuidRegex);
            return matches ? Array.from(new Set(matches)) : [];
        }
    }
    return [];
};

// Reads saved notes and upgrades old string-only notes.
// Legacy ids are deterministic (legacy-0, legacy-1, ...) so the id the frontend
// received on GET still matches when it is sent back on update.
const parseNotes = (notes: unknown, fallbackDate?: Date | null): Note[] => {
    let raw: unknown[] = [];
    if (Array.isArray(notes)) raw = notes;
    else if (typeof notes === "string") {
        try {
            const parsed = JSON.parse(notes);
            if (Array.isArray(parsed)) raw = parsed;
        } catch {
            return [];
        }
    }

    const fallback = (fallbackDate ?? new Date()).toISOString();
    return raw
        .map((n, index): Note | null => {
            if (typeof n === "string") {
                return { id: `legacy-${index}`, text: n, createdAt: fallback, updatedAt: fallback };
            }
            if (n && typeof n === "object" && typeof (n as any).text === "string") {
                const o = n as Partial<Note>;
                return {
                    id: o.id ?? `legacy-${index}`,
                    text: o.text!,
                    createdAt: o.createdAt ?? fallback,
                    updatedAt: o.updatedAt ?? o.createdAt ?? fallback,
                };
            }
            return null;
        })
        .filter((n): n is Note => n !== null);
};

// Merges incoming notes with saved ones and stamps dates only where something changed
const mergeNotes = (existing: Note[], incoming: NoteInput[]): Note[] => {
    const now = new Date().toISOString();
    const byId = new Map(existing.map((n) => [n.id, n]));
    const byText = new Map(existing.map((n) => [n.text, n]));

    return incoming.map((item): Note => {
        const text = typeof item === "string" ? item : item.text;
        const id = typeof item === "string" ? undefined : item.id;

        const prev = (id ? byId.get(id) : undefined) ?? byText.get(text);
        if (prev) {
            return prev.text === text ? prev : { ...prev, text, updatedAt: now };
        }
        return { id: id ?? randomUUID(), text, createdAt: now, updatedAt: now };
    });
};

export const getRestaurantOperations = async (req: Request, res: Response) => {
    const {
        search,
        restaurantId,
        restaurantType,
        operationType,
        status,
        startDate,
        endDate,
        app,
        page,
        limit,
    } = getRestaurantOperationsQuerySchema.parse(req.query);
    const offset = (page - 1) * limit;
    const filters = [];

    if (restaurantId) filters.push(eq(restaurantOperations.restaurantId, restaurantId));
    if (restaurantType) filters.push(eq(restaurants.type, restaurantType));
    if (operationType) filters.push(eq(restaurantOperations.operationType, operationType));
    if (status) filters.push(eq(restaurantOperations.status, status));
    if (app) filters.push(eq(restaurantOperations.app, app));
    if (search) {
        const searchPattern = `%${search}%`;
        filters.push(
            or(
                like(restaurants.name, searchPattern),
                like(restaurants.nameAr, searchPattern),
                like(restaurantOperations.restaurantId, searchPattern)
            )!
        );
    }

    const whereClause = filters.length > 0 ? and(...filters) : undefined;
    const [rows, totalRows] = await Promise.all([
        db
            .select({
                operation: {
                    id: restaurantOperations.id,
                    restaurantId: restaurantOperations.restaurantId,
                    operationType: restaurantOperations.operationType,
                    status: restaurantOperations.status,
                    app: restaurantOperations.app,
                    notes: restaurantOperations.notes,
                    createdAt: restaurantOperations.createdAt,
                    updatedAt: restaurantOperations.updatedAt,
                },
                restaurant: {
                    id: restaurants.id,
                    name: restaurants.name,
                    nameAr: restaurants.nameAr,
                    nameFr: restaurants.nameFr,
                    logo: restaurants.logo,
                    cover: restaurants.cover,
                    type: restaurants.type,
                    status: restaurants.status,
                    operationStatus: restaurants.operationStatus,
                    ownerFirstName: restaurants.ownerFirstName,
                    ownerLastName: restaurants.ownerLastName,
                    ownerPhone: restaurants.ownerPhone,
                    callcenterphone: restaurants.callcenterphone,
                    orderLink: restaurants.orderLink,
                    facebookLink: restaurants.facebookLink,
                    cuisineId: restaurants.cuisineId,
                },
                city: {
                    id: cities.id,
                    name: cities.name,
                    nameAr: cities.nameAr,
                },
                sales: {
                    id: sales.id,
                    name: sales.name,
                    phone: sales.phone,
                    email: sales.email,
                },
            })
            .from(restaurantOperations)
            .innerJoin(restaurants, eq(restaurantOperations.restaurantId, restaurants.id))
            .leftJoin(cities, eq(restaurants.cityId, cities.id))
            .leftJoin(sales, eq(restaurants.salesId, sales.id))
            .where(whereClause)
            .limit(limit)
            .offset(offset),
        db
            .select({ total: count() })
            .from(restaurantOperations)
            .innerJoin(restaurants, eq(restaurantOperations.restaurantId, restaurants.id))
            .where(whereClause),
    ]);

    const totalItems = Number(totalRows[0]?.total ?? 0);
    const restaurantIds = rows.map((row) => row.restaurant.id);
    const cuisineIds = Array.from(
        new Set(rows.flatMap((row) => parseCuisineIds(row.restaurant.cuisineId)))
    );

    const activeRestaurantIds = Array.from(
        new Set(
            rows
                .filter((row) => row.restaurant.operationStatus === "active")
                .map((row) => row.restaurant.id)
        )
    );

    const orderConditions = [inArray(orders.restaurantId, activeRestaurantIds)];
    if (startDate) {
        orderConditions.push(gte(orders.createdAt, new Date(startDate)));
    }
    if (endDate) {
        const end = new Date(endDate);
        if (!endDate.includes("T")) {
            end.setHours(23, 59, 59, 999);
        } else if (
            end.getHours() === 0 &&
            end.getMinutes() === 0 &&
            end.getSeconds() === 0 &&
            end.getMilliseconds() === 0
        ) {
            end.setHours(23, 59, 59, 999);
        }
        orderConditions.push(lte(orders.createdAt, end));
    }

    const [branchRows, cuisineRows, orderStatsRows] = await Promise.all([
        restaurantIds.length > 0
            ? db
                .select({
                    branch: {
                        id: branches.id,
                        restaurantId: branches.restaurantId,
                        name: branches.name,
                        nameAr: branches.nameAr,
                        phoneNumber: branches.phoneNumber,
                        address: branches.address,
                        addressAr: branches.addressAr,
                        status: branches.status,
                    },
                    city: {
                        id: cities.id,
                        name: cities.name,
                        nameAr: cities.nameAr,
                    },
                })
                .from(branches)
                .leftJoin(cities, eq(branches.cityId, cities.id))
                .where(inArray(branches.restaurantId, restaurantIds))
            : Promise.resolve([]),
        cuisineIds.length > 0
            ? db
                .select({
                    id: cuisines.id,
                    name: cuisines.name,
                    nameAr: cuisines.nameAr,
                    image: cuisines.Image,
                })
                .from(cuisines)
                .where(inArray(cuisines.id, cuisineIds))
            : Promise.resolve([]),
        activeRestaurantIds.length > 0
            ? db
                .select({
                    restaurantId: orders.restaurantId,
                    totalOrders: count(orders.id),
                    canceledOrders: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} = 'cancelled' THEN 1 ELSE 0 END), 0)`,
                })
                .from(orders)
                .where(and(...orderConditions))
                .groupBy(orders.restaurantId)
            : Promise.resolve([]),
    ]);

    const branchMap = new Map<string, typeof branchRows>();
    for (const branchRow of branchRows) {
        const restaurantBranches = branchMap.get(branchRow.branch.restaurantId) ?? [];
        restaurantBranches.push(branchRow);
        branchMap.set(branchRow.branch.restaurantId, restaurantBranches);
    }
    const cuisineMap = new Map(cuisineRows.map((cuisine) => [cuisine.id, cuisine]));

    const orderStatsMap = new Map<string, { totalOrders: number; canceledOrders: number }>();
    for (const stat of orderStatsRows) {
        orderStatsMap.set(stat.restaurantId, {
            totalOrders: Number(stat.totalOrders || 0),
            canceledOrders: Number(stat.canceledOrders || 0),
        });
    }

    return SuccessResponse(res, {
        data: rows.map(({ operation, restaurant, city, sales: salesRep }) => {
            const parsedCuisineIds = parseCuisineIds(restaurant.cuisineId);
            const { cuisineId: _, ...restRestaurant } = restaurant;

            const isOperationActive = restaurant.operationStatus === "active";
            const stats = isOperationActive
                ? orderStatsMap.get(restaurant.id) ?? { totalOrders: 0, canceledOrders: 0 }
                : null;

            const orderMetrics = stats
                ? {
                    totalOrders: stats.totalOrders,
                    canceledOrders: stats.canceledOrders,
                }
                : {};

            return {
                ...operation,
                notes: parseNotes(operation.notes, operation.createdAt),
                restaurant: {
                    ...restRestaurant,
                    ...orderMetrics,
                    city: city?.id ? city : null,
                    sales: salesRep?.id ? salesRep : null,
                    branches: (branchMap.get(restaurant.id) ?? []).map(
                        ({ branch, city: branchCity }) => ({
                            id: branch.id,
                            name: branch.name,
                            nameAr: branch.nameAr,
                            phoneNumber: branch.phoneNumber,
                            address: branch.address,
                            addressAr: branch.addressAr,
                            status: branch.status,
                            city: branchCity?.id ? branchCity : null,
                        })
                    ),
                    cuisines: parsedCuisineIds
                        .map((id) => cuisineMap.get(id))
                        .filter((cuisine): cuisine is NonNullable<typeof cuisine> => Boolean(cuisine)),
                },
            };
        }),
        pagination: {
            page,
            limit,
            totalItems,
            totalPages: Math.ceil(totalItems / limit),
        },
    });
};

export const updateRestaurantOperation = async (req: Request, res: Response) => {
    const { restaurantId } = updateRestaurantOperationParamsSchema.parse(req.params);
    const changes = updateRestaurantOperationSchema.parse(req.body);

    const [restaurant] = await db
        .select({ id: restaurants.id })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);
    if (!restaurant) throw new NotFound("Restaurant not found");

    const [existing] = await db
        .select()
        .from(restaurantOperations)
        .where(eq(restaurantOperations.restaurantId, restaurantId))
        .limit(1);

    const values = {
        ...(changes.operationType !== undefined && { operationType: changes.operationType }),
        ...(changes.status !== undefined && { status: changes.status }),
        ...(changes.app !== undefined && { app: changes.app }),
        ...(changes.notes !== undefined && {
            notes: mergeNotes(parseNotes(existing?.notes, existing?.createdAt), changes.notes),
        }),
        updatedAt: new Date(),
    };

    if (existing) {
        await db
            .update(restaurantOperations)
            .set(values)
            .where(eq(restaurantOperations.id, existing.id));
    } else {
        await db.insert(restaurantOperations).values({
            restaurantId,
            operationType: changes.operationType ?? "callcenter",
            status: changes.status,
            app: changes.app,
            notes: mergeNotes([], changes.notes ?? []),
        });
    }

    const [updated] = await db
        .select()
        .from(restaurantOperations)
        .where(eq(restaurantOperations.restaurantId, restaurantId))
        .limit(1);

    return SuccessResponse(res, {
        message: "Restaurant operation updated successfully",
        data: {
            ...updated,
            notes: parseNotes(updated?.notes, updated?.createdAt),
        },
    });
};