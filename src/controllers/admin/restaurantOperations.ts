import { Request, Response } from "express";
import { and, count, eq, inArray, like, or } from "drizzle-orm";
import { db } from "../../models/connection";
import {
    branches,
    cities,
    cuisines,
    restaurantOperations,
    restaurants,
} from "../../models/schema";
import { NotFound } from "../../Errors/NotFound";
import { SuccessResponse } from "../../utils/response";
import {
    getRestaurantOperationsQuerySchema,
    updateRestaurantOperationParamsSchema,
    updateRestaurantOperationSchema,
} from "../../validation/admin/restaurantOperations";

export const getRestaurantOperations = async (req: Request, res: Response) => {
    const { search, operationType, status, app, page, limit } =
        getRestaurantOperationsQuerySchema.parse(req.query);
    const offset = (page - 1) * limit;
    const filters = [];

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
                restaurant: restaurants,
                city: cities,
            })
            .from(restaurantOperations)
            .innerJoin(restaurants, eq(restaurantOperations.restaurantId, restaurants.id))
            .leftJoin(cities, eq(restaurants.cityId, cities.id))
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
    const cuisineIds = [
        ...new Set(
            rows.flatMap((row) =>
                Array.isArray(row.restaurant.cuisineId) ? row.restaurant.cuisineId : []
            )
        ),
    ];

    const [branchRows, cuisineRows] = await Promise.all([
        restaurantIds.length > 0
            ? db
                .select({ branch: branches, city: cities })
                .from(branches)
                .leftJoin(cities, eq(branches.cityId, cities.id))
                .where(inArray(branches.restaurantId, restaurantIds))
            : Promise.resolve([]),
        cuisineIds.length > 0
            ? db.select().from(cuisines).where(inArray(cuisines.id, cuisineIds))
            : Promise.resolve([]),
    ]);

    const branchMap = new Map<string, typeof branchRows>();
    for (const branchRow of branchRows) {
        const restaurantBranches = branchMap.get(branchRow.branch.restaurantId) ?? [];
        restaurantBranches.push(branchRow);
        branchMap.set(branchRow.branch.restaurantId, restaurantBranches);
    }
    const cuisineMap = new Map(cuisineRows.map((cuisine) => [cuisine.id, cuisine]));

    return SuccessResponse(res, {
        data: rows.map(({ operation, restaurant, city }) => ({
            ...operation,
            notes: Array.isArray(operation.notes)
                ? operation.notes
                : typeof operation.notes === "string"
                ? JSON.parse(operation.notes)
                : [],
            restaurant: {
                ...restaurant,
                city,
                branches: (branchMap.get(restaurant.id) ?? []).map(({ branch, city: branchCity }) => ({
                    ...branch,
                    city: branchCity,
                })),
                cuisines: (Array.isArray(restaurant.cuisineId) ? restaurant.cuisineId : [])
                    .map((cuisineId) => cuisineMap.get(cuisineId))
                    .filter((cuisine) => cuisine !== undefined),
            },
        })),
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
        ...(changes.notes !== undefined && { notes: changes.notes }),
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
            notes: changes.notes ?? [],
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
            notes: Array.isArray(updated?.notes)
                ? updated.notes
                : typeof updated?.notes === "string"
                ? JSON.parse(updated.notes)
                : [],
        },
    });
};