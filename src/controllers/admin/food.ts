import { Request, Response } from "express";
import { db } from "../../models/connection";
import {
    food,
    foodVariations,
    variationOptions,
    restaurants,
    categories,
    subcategories,
    addons,
} from "../../models/schema";
import { eq, inArray } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors/NotFound";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";

// =============================================
// CREATE Food
// =============================================
export const createFood = async (req: Request, res: Response) => {
    const {
        name, nameAr, nameFr, description, descriptionAr, descriptionFr, image,
        restaurantid, categoryid, subcategoryid,
        foodtype, Nutrition, allergen_ingredients, is_Halal,
        addonsId, startTime, endTime, search_tags,
        price, discount_type, discount_value, Maximum_Purchase, stock_type,
        status,
        variations,
    } = req.body;

    if (!name || !nameAr || !nameFr || !description || !descriptionAr || !descriptionFr || !image || !categoryid || !subcategoryid || !startTime || !endTime || !price) {
        throw new BadRequest("Missing required fields");
    }

    const existingRestaurant = await db.select().from(restaurants).where(eq(restaurants.id, restaurantid)).limit(1);
    if (!existingRestaurant[0]) throw new BadRequest("Restaurant not found");

    const existingCategory = await db.select().from(categories).where(eq(categories.id, categoryid)).limit(1);
    if (!existingCategory[0]) throw new BadRequest("Category not found");

    const existingSub = await db.select().from(subcategories).where(eq(subcategories.id, subcategoryid)).limit(1);
    if (!existingSub[0]) throw new BadRequest("Subcategory not found");

    if (addonsId) {
        const existingAddon = await db.select().from(addons).where(eq(addons.id, addonsId)).limit(1);
        if (!existingAddon[0]) throw new BadRequest("Addon not found");
    }

    const foodId = uuidv4();

    await db.insert(food).values({
        id: foodId,
        name,
        nameAr,
        nameFr,
        description,
        descriptionAr,
        descriptionFr,
        image,
        restaurantid,
        categoryid,
        subcategoryid,
        foodtype: foodtype || "veg",
        Nutrition: Nutrition || null,
        allergen_ingredients: allergen_ingredients || null,
        is_Halal: is_Halal ?? false,
        addonsId: addonsId || null,
        startTime,
        endTime,
        search_tags: search_tags || null,
        price,
        discount_type: discount_type || "percentage",
        discount_value: discount_value || null,
        Maximum_Purchase: Maximum_Purchase || null,
        stock_type: stock_type || "unlimited",
        variations: variations || null,
        status: status || "active",
    });

    if (variations && Array.isArray(variations)) {
        for (const variation of variations) {
            const variationId = uuidv4();

            if(!variation.nameAr || !variation.nameFr) throw new BadRequest("Variation nameAr, nameFr are required");

            await db.insert(foodVariations).values({
                id: variationId,
                foodId,
                name: variation.name,
                nameAr: variation.nameAr,
                nameFr: variation.nameFr,
                isRequired: variation.isRequired || false,
                selectionType: variation.selectionType || "single",
                min: variation.min || null,
                max: variation.max || null,
            });

            if (variation.options && Array.isArray(variation.options)) {
                for (const option of variation.options) {
                    if(!option.optionNameAr || !option.optionNameFr) throw new BadRequest("Option optionNameAr, optionNameFr are required");
                    await db.insert(variationOptions).values({
                        variationId,
                        optionName: option.optionName,
                        optionNameAr: option.optionNameAr,
                        optionNameFr: option.optionNameFr,
                        // ✅ FIX: decimal لازم string
                        additionalPrice: option.additionalPrice?.toString() || "0",
                    });
                }
            }
        }
    }

    return SuccessResponse(res, { message: "Create food success", data: { id: foodId } }, 201);
};

// =============================================
// GET ALL Foods (Optimized)
// =============================================
export const getAllFoods = async (req: Request, res: Response) => {
    const rawFoods = await db.select({
        // ✅ Food fields
        id: food.id,
        name: food.name,
        nameAr: food.nameAr,
        nameFr: food.nameFr,
        description: food.description,
        descriptionAr: food.descriptionAr,
        descriptionFr: food.descriptionFr,
        image: food.image,
        restaurantid: food.restaurantid,
        categoryid: food.categoryid,
        subcategoryid: food.subcategoryid,
        foodtype: food.foodtype,
        Nutrition: food.Nutrition,
        allergen_ingredients: food.allergen_ingredients,
        is_Halal: food.is_Halal,
        addonsId: food.addonsId,
        startTime: food.startTime,
        endTime: food.endTime,
        search_tags: food.search_tags,
        price: food.price,
        discount_type: food.discount_type,
        discount_value: food.discount_value,
        Maximum_Purchase: food.Maximum_Purchase,
        stock_type: food.stock_type,
        status: food.status,
        createdAt: food.createdAt,
        updatedAt: food.updatedAt,

        // ✅ Restaurant (alias مهم)
        restaurant_id: restaurants.id,
        restaurant_name: restaurants.name,
        restaurant_nameAr: restaurants.nameAr,
        restaurant_nameFr: restaurants.nameFr,

        // ✅ Category
        category_name: categories.name,
        category_nameAr: categories.nameAr,
        category_nameFr: categories.nameFr,

        // ✅ Subcategory
        subcategory_name: subcategories.name,
        subcategory_nameAr: subcategories.nameAr,
        subcategory_nameFr: subcategories.nameFr,
    })
        .from(food)
        .leftJoin(restaurants, eq(food.restaurantid, restaurants.id))
        .leftJoin(categories, eq(food.categoryid, categories.id))
        .leftJoin(subcategories, eq(food.subcategoryid, subcategories.id));

    if (rawFoods.length === 0) {
        return SuccessResponse(res, { message: "Get all foods success", data: [] });
    }

    // ✅ إعادة بناء الشكل
    const allFoods = rawFoods.map(f => ({
        id: f.id,
        name: f.name,
        nameAr: f.nameAr,
        nameFr: f.nameFr,
        description: f.description,
        descriptionAr: f.descriptionAr,
        descriptionFr: f.descriptionFr,
        image: f.image,
        price: f.price,

        restaurant: f.restaurant_id
            ? { id: f.restaurant_id, name: f.restaurant_name, nameAr: f.restaurant_nameAr, nameFr: f.restaurant_nameFr }
            : null,

        category: f.category_name
            ? { name: f.category_name, nameAr: f.category_nameAr, nameFr: f.category_nameFr }
            : null,

        subcategory: f.subcategory_name
            ? { name: f.subcategory_name, nameAr: f.subcategory_nameAr, nameFr: f.subcategory_nameFr }
            : null,
    }));

    return SuccessResponse(res, {
        message: "Get all foods success",
        data: allFoods
    });
};

// =============================================
// GET Food By ID (FIXED SELECT)
// =============================================
export const getFoodById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const foodItem = await db.select({
        id: food.id,
        name: food.name,
        nameAr: food.nameAr,
        nameFr: food.nameFr,
        description: food.description,
        descriptionAr: food.descriptionAr,
        descriptionFr: food.descriptionFr,
        image: food.image,
        restaurantid: food.restaurantid,
        categoryid: food.categoryid,
        subcategoryid: food.subcategoryid,
        foodtype: food.foodtype,
        Nutrition: food.Nutrition,
        allergen_ingredients: food.allergen_ingredients,
        is_Halal: food.is_Halal,
        addonsId: food.addonsId,
        startTime: food.startTime,
        endTime: food.endTime,
        search_tags: food.search_tags,
        price: food.price,
        discount_type: food.discount_type,
        discount_value: food.discount_value,
        Maximum_Purchase: food.Maximum_Purchase,
        stock_type: food.stock_type,
        status: food.status,
        createdAt: food.createdAt,
        updatedAt: food.updatedAt,
        restaurant: {
            id: restaurants.id,
            name: restaurants.name,
            nameAr: restaurants.nameAr,
            nameFr: restaurants.nameFr,
        },
        category: {
            id: categories.id,
            name: categories.name,
            nameAr: categories.nameAr,
            nameFr: categories.nameFr,
        },
        subcategory: {
            id: subcategories.id,
            name: subcategories.name,
            nameAr: subcategories.nameAr,
            nameFr: subcategories.nameFr,
        },
    })
        .from(food)
        .leftJoin(restaurants, eq(food.restaurantid, restaurants.id))
        .leftJoin(categories, eq(food.categoryid, categories.id))
        .leftJoin(subcategories, eq(food.subcategoryid, subcategories.id))
        .where(eq(food.id, id))
        .limit(1);

    if (!foodItem[0]) throw new NotFound("Food not found");

    const vars = await db.select().from(foodVariations).where(eq(foodVariations.foodId, id));
    const varIds = vars.map(v => v.id);

    const opts = varIds.length
        ? await db.select().from(variationOptions).where(inArray(variationOptions.variationId, varIds))
        : [];

    const variations = vars.map(v => ({
        ...v,
        options: opts.filter(o => o.variationId === v.id)
    }));

    return SuccessResponse(res, {
        message: "Get food by id success",
        data: { ...foodItem[0], variations }
    });
};

// =============================================
// UPDATE Food
// =============================================
export const updateFood = async (req: Request, res: Response) => {
    const { id } = req.params;
    const data = req.body;

    const existingFood = await db.select().from(food).where(eq(food.id, id)).limit(1);
    if (!existingFood[0]) throw new NotFound("Food not found");

    const updateData: any = { updatedAt: new Date() };

    Object.keys(data).forEach(key => {
        if (key !== 'variations') {
            updateData[key] = data[key];
        }
    });

    await db.update(food).set(updateData).where(eq(food.id, id));

    if (data.variations && Array.isArray(data.variations)) {
        const oldVars = await db.select().from(foodVariations).where(eq(foodVariations.foodId, id));

        for (const v of oldVars) {
            await db.delete(variationOptions).where(eq(variationOptions.variationId, v.id));
        }

        await db.delete(foodVariations).where(eq(foodVariations.foodId, id));

        for (const variation of data.variations) {
            const variationId = uuidv4();
            if(!variation.nameAr || !variation.nameFr) throw new BadRequest("Variation nameAr, nameFr are required");

            await db.insert(foodVariations).values({
                id: variationId,
                foodId: id,
                name: variation.name,
                nameAr: variation.nameAr,
                nameFr: variation.nameFr,
                isRequired: variation.isRequired || false,
                selectionType: variation.selectionType || "single",
                min: variation.min || null,
                max: variation.max || null,
            });

            if (variation.options) {
                for (const option of variation.options) {
                    if(!option.optionNameAr || !option.optionNameFr) throw new BadRequest("Option optionNameAr, optionNameFr are required");
                    await db.insert(variationOptions).values({
                        variationId,
                        optionName: option.optionName,
                        optionNameAr: option.optionNameAr,
                        optionNameFr: option.optionNameFr,
                        additionalPrice: option.additionalPrice?.toString() || "0",
                    });
                }
            }
        }
    }

    return SuccessResponse(res, { message: "Update food success" });
};

// =============================================
// DELETE Food
// =============================================
export const deleteFood = async (req: Request, res: Response) => {
    const { id } = req.params;

    const existingFood = await db.select().from(food).where(eq(food.id, id)).limit(1);
    if (!existingFood[0]) throw new NotFound("Food not found");

    const vars = await db.select().from(foodVariations).where(eq(foodVariations.foodId, id));

    for (const v of vars) {
        await db.delete(variationOptions).where(eq(variationOptions.variationId, v.id));
    }

    await db.delete(foodVariations).where(eq(foodVariations.foodId, id));
    await db.delete(food).where(eq(food.id, id));

    return SuccessResponse(res, { message: "Delete food success" });
};


export const getFoodsByRestaurantId = async (req: Request, res: Response) => {
    const { id: restaurantId } = req.params;

    const foods = await db.select({
        foodObj: food,
        restaurantObj: restaurants,
        categoryObj: categories,
        subcategoryObj: subcategories,
    })
        .from(food)
        .leftJoin(restaurants, eq(food.restaurantid, restaurants.id))
        .leftJoin(categories, eq(food.categoryid, categories.id))
        .leftJoin(subcategories, eq(food.subcategoryid, subcategories.id))
        .where(eq(food.restaurantid, restaurantId));

    if (foods.length === 0) {
        return SuccessResponse(res, { message: "No foods found", data: [] });
    }

    const formatted = foods.map(row => ({
        ...row.foodObj,
        restaurant: row.restaurantObj ? { id: row.restaurantObj.id, name: row.restaurantObj.name } : null,
        category: row.categoryObj ? { id: row.categoryObj.id, name: row.categoryObj.name } : null,
        subcategory: row.subcategoryObj ? { id: row.subcategoryObj.id, name: row.subcategoryObj.name } : null,
    }));

    const foodIds = formatted.map(f => f.id);

    const vars = await db.select().from(foodVariations).where(inArray(foodVariations.foodId, foodIds));
    const varIds = vars.map(v => v.id);

    const opts = varIds.length
        ? await db.select().from(variationOptions).where(inArray(variationOptions.variationId, varIds))
        : [];

    const result = formatted.map(f => {
        const foodVars = vars
            .filter(v => v.foodId === f.id)
            .map(v => ({
                ...v,
                options: opts.filter(o => o.variationId === v.id)
            }));
        return { ...f, variations: foodVars };
    });

    return SuccessResponse(res, { message: "Get foods by restaurant id success", data: result });
};


export const getFoodSelectData = async (req: Request, res: Response) => {
    const allRestaurants = await db
        .select({ id: restaurants.id, name: restaurants.name })
        .from(restaurants)
        .where(eq(restaurants.status, "active"));

    const allCategories = await db
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .where(eq(categories.status, "active"));

    const allSubcategories = await db
        .select({
            id: subcategories.id,
            name: subcategories.name,
            categoryId: subcategories.categoryId
        })
        .from(subcategories)
        .where(eq(subcategories.status, "active"));

    const allAddons = await db
        .select({ id: addons.id, name: addons.name })
        .from(addons)
        .where(eq(addons.status, "active"));

    return SuccessResponse(res, {
        message: "Get food select data success",
        data: {
            allRestaurants,
            allCategories,
            allSubcategories,
            allAddons
        }
    });
};