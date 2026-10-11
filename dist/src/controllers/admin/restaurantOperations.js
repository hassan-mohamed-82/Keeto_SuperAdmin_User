"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateRestaurantOperation = exports.getRestaurantOperations = void 0;
const crypto_1 = require("crypto");
const drizzle_orm_1 = require("drizzle-orm");
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const NotFound_1 = require("../../Errors/NotFound");
const response_1 = require("../../utils/response");
const restaurantOperations_1 = require("../../validation/admin/restaurantOperations");
const parseCuisineIds = (input) => {
    if (!input)
        return [];
    if (Array.isArray(input)) {
        return input.filter((id) => typeof id === "string" && id.trim().length > 0);
    }
    if (typeof input === "string") {
        try {
            const parsed = JSON.parse(input);
            if (Array.isArray(parsed)) {
                return parsed.filter((id) => typeof id === "string" && id.trim().length > 0);
            }
        }
        catch {
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
const parseNotes = (notes, fallbackDate) => {
    let raw = [];
    if (Array.isArray(notes))
        raw = notes;
    else if (typeof notes === "string") {
        try {
            const parsed = JSON.parse(notes);
            if (Array.isArray(parsed))
                raw = parsed;
        }
        catch {
            return [];
        }
    }
    const fallback = (fallbackDate ?? new Date()).toISOString();
    return raw
        .map((n, index) => {
        if (typeof n === "string") {
            return { id: `legacy-${index}`, text: n, createdAt: fallback, updatedAt: fallback };
        }
        if (n && typeof n === "object" && typeof n.text === "string") {
            const o = n;
            return {
                id: o.id ?? `legacy-${index}`,
                text: o.text,
                createdAt: o.createdAt ?? fallback,
                updatedAt: o.updatedAt ?? o.createdAt ?? fallback,
            };
        }
        return null;
    })
        .filter((n) => n !== null);
};
// Merges incoming notes with saved ones and stamps dates only where something changed
const mergeNotes = (existing, incoming) => {
    const now = new Date().toISOString();
    const byId = new Map(existing.map((n) => [n.id, n]));
    const byText = new Map(existing.map((n) => [n.text, n]));
    return incoming.map((item) => {
        const text = typeof item === "string" ? item : item.text;
        const id = typeof item === "string" ? undefined : item.id;
        const prev = (id ? byId.get(id) : undefined) ?? byText.get(text);
        if (prev) {
            return prev.text === text ? prev : { ...prev, text, updatedAt: now };
        }
        return { id: id ?? (0, crypto_1.randomUUID)(), text, createdAt: now, updatedAt: now };
    });
};
const getRestaurantOperations = async (req, res) => {
    const { search, restaurantId, restaurantType, operationType, status, app, page, limit } = restaurantOperations_1.getRestaurantOperationsQuerySchema.parse(req.query);
    const offset = (page - 1) * limit;
    const filters = [];
    if (restaurantId)
        filters.push((0, drizzle_orm_1.eq)(schema_1.restaurantOperations.restaurantId, restaurantId));
    if (restaurantType)
        filters.push((0, drizzle_orm_1.eq)(schema_1.restaurants.type, restaurantType));
    if (operationType)
        filters.push((0, drizzle_orm_1.eq)(schema_1.restaurantOperations.operationType, operationType));
    if (status)
        filters.push((0, drizzle_orm_1.eq)(schema_1.restaurantOperations.status, status));
    if (app)
        filters.push((0, drizzle_orm_1.eq)(schema_1.restaurantOperations.app, app));
    if (search) {
        const searchPattern = `%${search}%`;
        filters.push((0, drizzle_orm_1.or)((0, drizzle_orm_1.like)(schema_1.restaurants.name, searchPattern), (0, drizzle_orm_1.like)(schema_1.restaurants.nameAr, searchPattern), (0, drizzle_orm_1.like)(schema_1.restaurantOperations.restaurantId, searchPattern)));
    }
    const whereClause = filters.length > 0 ? (0, drizzle_orm_1.and)(...filters) : undefined;
    const [rows, totalRows] = await Promise.all([
        connection_1.db
            .select({
            operation: {
                id: schema_1.restaurantOperations.id,
                restaurantId: schema_1.restaurantOperations.restaurantId,
                operationType: schema_1.restaurantOperations.operationType,
                status: schema_1.restaurantOperations.status,
                app: schema_1.restaurantOperations.app,
                notes: schema_1.restaurantOperations.notes,
                createdAt: schema_1.restaurantOperations.createdAt,
                updatedAt: schema_1.restaurantOperations.updatedAt,
            },
            restaurant: {
                id: schema_1.restaurants.id,
                name: schema_1.restaurants.name,
                nameAr: schema_1.restaurants.nameAr,
                nameFr: schema_1.restaurants.nameFr,
                logo: schema_1.restaurants.logo,
                cover: schema_1.restaurants.cover,
                type: schema_1.restaurants.type,
                status: schema_1.restaurants.status,
                ownerFirstName: schema_1.restaurants.ownerFirstName,
                ownerLastName: schema_1.restaurants.ownerLastName,
                ownerPhone: schema_1.restaurants.ownerPhone,
                callcenterphone: schema_1.restaurants.callcenterphone,
                orderLink: schema_1.restaurants.orderLink,
                facebookLink: schema_1.restaurants.facebookLink,
                cuisineId: schema_1.restaurants.cuisineId,
            },
            city: {
                id: schema_1.cities.id,
                name: schema_1.cities.name,
                nameAr: schema_1.cities.nameAr,
            },
            sales: {
                id: schema_1.sales.id,
                name: schema_1.sales.name,
                phone: schema_1.sales.phone,
                email: schema_1.sales.email,
            },
        })
            .from(schema_1.restaurantOperations)
            .innerJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.restaurantOperations.restaurantId, schema_1.restaurants.id))
            .leftJoin(schema_1.cities, (0, drizzle_orm_1.eq)(schema_1.restaurants.cityId, schema_1.cities.id))
            .leftJoin(schema_1.sales, (0, drizzle_orm_1.eq)(schema_1.restaurants.salesId, schema_1.sales.id))
            .where(whereClause)
            .limit(limit)
            .offset(offset),
        connection_1.db
            .select({ total: (0, drizzle_orm_1.count)() })
            .from(schema_1.restaurantOperations)
            .innerJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.restaurantOperations.restaurantId, schema_1.restaurants.id))
            .where(whereClause),
    ]);
    const totalItems = Number(totalRows[0]?.total ?? 0);
    const restaurantIds = rows.map((row) => row.restaurant.id);
    const cuisineIds = Array.from(new Set(rows.flatMap((row) => parseCuisineIds(row.restaurant.cuisineId))));
    const [branchRows, cuisineRows] = await Promise.all([
        restaurantIds.length > 0
            ? connection_1.db
                .select({
                branch: {
                    id: schema_1.branches.id,
                    restaurantId: schema_1.branches.restaurantId,
                    name: schema_1.branches.name,
                    nameAr: schema_1.branches.nameAr,
                    phoneNumber: schema_1.branches.phoneNumber,
                    address: schema_1.branches.address,
                    addressAr: schema_1.branches.addressAr,
                    status: schema_1.branches.status,
                },
                city: {
                    id: schema_1.cities.id,
                    name: schema_1.cities.name,
                    nameAr: schema_1.cities.nameAr,
                },
            })
                .from(schema_1.branches)
                .leftJoin(schema_1.cities, (0, drizzle_orm_1.eq)(schema_1.branches.cityId, schema_1.cities.id))
                .where((0, drizzle_orm_1.inArray)(schema_1.branches.restaurantId, restaurantIds))
            : Promise.resolve([]),
        cuisineIds.length > 0
            ? connection_1.db
                .select({
                id: schema_1.cuisines.id,
                name: schema_1.cuisines.name,
                nameAr: schema_1.cuisines.nameAr,
                image: schema_1.cuisines.Image,
            })
                .from(schema_1.cuisines)
                .where((0, drizzle_orm_1.inArray)(schema_1.cuisines.id, cuisineIds))
            : Promise.resolve([]),
    ]);
    const branchMap = new Map();
    for (const branchRow of branchRows) {
        const restaurantBranches = branchMap.get(branchRow.branch.restaurantId) ?? [];
        restaurantBranches.push(branchRow);
        branchMap.set(branchRow.branch.restaurantId, restaurantBranches);
    }
    const cuisineMap = new Map(cuisineRows.map((cuisine) => [cuisine.id, cuisine]));
    return (0, response_1.SuccessResponse)(res, {
        data: rows.map(({ operation, restaurant, city, sales: salesRep }) => {
            const parsedCuisineIds = parseCuisineIds(restaurant.cuisineId);
            const { cuisineId: _, ...restRestaurant } = restaurant;
            return {
                ...operation,
                notes: parseNotes(operation.notes, operation.createdAt),
                restaurant: {
                    ...restRestaurant,
                    city: city?.id ? city : null,
                    sales: salesRep?.id ? salesRep : null,
                    branches: (branchMap.get(restaurant.id) ?? []).map(({ branch, city: branchCity }) => ({
                        id: branch.id,
                        name: branch.name,
                        nameAr: branch.nameAr,
                        phoneNumber: branch.phoneNumber,
                        address: branch.address,
                        addressAr: branch.addressAr,
                        status: branch.status,
                        city: branchCity?.id ? branchCity : null,
                    })),
                    cuisines: parsedCuisineIds
                        .map((id) => cuisineMap.get(id))
                        .filter((cuisine) => Boolean(cuisine)),
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
exports.getRestaurantOperations = getRestaurantOperations;
const updateRestaurantOperation = async (req, res) => {
    const { restaurantId } = restaurantOperations_1.updateRestaurantOperationParamsSchema.parse(req.params);
    const changes = restaurantOperations_1.updateRestaurantOperationSchema.parse(req.body);
    const [restaurant] = await connection_1.db
        .select({ id: schema_1.restaurants.id })
        .from(schema_1.restaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantId))
        .limit(1);
    if (!restaurant)
        throw new NotFound_1.NotFound("Restaurant not found");
    const [existing] = await connection_1.db
        .select()
        .from(schema_1.restaurantOperations)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantOperations.restaurantId, restaurantId))
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
        await connection_1.db
            .update(schema_1.restaurantOperations)
            .set(values)
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantOperations.id, existing.id));
    }
    else {
        await connection_1.db.insert(schema_1.restaurantOperations).values({
            restaurantId,
            operationType: changes.operationType ?? "callcenter",
            status: changes.status,
            app: changes.app,
            notes: mergeNotes([], changes.notes ?? []),
        });
    }
    const [updated] = await connection_1.db
        .select()
        .from(schema_1.restaurantOperations)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantOperations.restaurantId, restaurantId))
        .limit(1);
    return (0, response_1.SuccessResponse)(res, {
        message: "Restaurant operation updated successfully",
        data: {
            ...updated,
            notes: parseNotes(updated?.notes, updated?.createdAt),
        },
    });
};
exports.updateRestaurantOperation = updateRestaurantOperation;
