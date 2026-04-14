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
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors/NotFound";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";
import { inArray } from "drizzle-orm"; // تأكد من استدعاء inArray فوق مع eq
// =============================================
// CREATE Food + Variations + Options in one API
// =============================================
export const createFood = async (req: Request, res: Response) => {
    const {
        name, description, image,
        restaurantid, categoryid, subcategoryid,
        foodtype, Nutrition, Allegren_Ingredients, is_Halal,
        addonsId, startTime, endTime, search_tages,
        price, discount_type, discount_value, Maximum_Purchase, stock_type,
        status,
        variations, // Array of { name, isRequired, selectionType, min, max, options: [{ optionName, additionalPrice }] }
    } = req.body;

    // Required fields
    if (!name || !description || !image || !categoryid || !subcategoryid || !startTime || !endTime || !price) {
        throw new BadRequest("Missing required fields: name, description, image, restaurantid, categoryid, subcategoryid, startTime, endTime, price");
    }

    // Validate restaurant
    const existingRestaurant = await db.select().from(restaurants).where(eq(restaurants.id, restaurantid)).limit(1);
    if (!existingRestaurant[0]) throw new BadRequest("Restaurant not found");

    // Validate category
    const existingCategory = await db.select().from(categories).where(eq(categories.id, categoryid)).limit(1);
    if (!existingCategory[0]) throw new BadRequest("Category not found");

    // Validate subcategory
    const existingSub = await db.select().from(subcategories).where(eq(subcategories.id, subcategoryid)).limit(1);
    if (!existingSub[0]) throw new BadRequest("Subcategory not found");

    // Validate addon if provided
    if (addonsId) {
        const existingAddon = await db.select().from(addons).where(eq(addons.id, addonsId)).limit(1);
        if (!existingAddon[0]) throw new BadRequest("Addon not found");
    }

    const foodId = uuidv4();

    // 1. Insert food
    await db.insert(food).values({
        id: foodId,
        name,
        description,
        image,
        restaurantid,
        categoryid,
        subcategoryid,
        foodtype: foodtype || "veg",
        Nutrition: Nutrition || null,
        Allegren_Ingredients: Allegren_Ingredients || null,
        is_Halal: is_Halal || false,
        addonsId: addonsId || null,
        startTime,
        endTime,
        search_tages: search_tages || null,
        price,
        discount_type: discount_type || "percentage",
        discount_value: discount_value || null,
        Maximum_Purchase: Maximum_Purchase || null,
        stock_type: stock_type || "unlimited",
        variations: variations || null, // store raw JSON snapshot
        status: status || "active",
    });

    // 2. Insert variations & options if provided
    if (variations && Array.isArray(variations) && variations.length > 0) {
        for (const variation of variations) {
            const variationId = uuidv4();

            await db.insert(foodVariations).values({
                id: variationId,
                foodId,
                name: variation.name,
                isRequired: variation.isRequired || false,
                selectionType: variation.selectionType || "single",
                min: variation.min || null,
                max: variation.max || null,
            });

            // Insert options for this variation
            if (variation.options && Array.isArray(variation.options) && variation.options.length > 0) {
                for (const option of variation.options) {
                    await db.insert(variationOptions).values({
                        id: uuidv4(),
                        variationId,
                        optionName: option.optionName,
                        additionalPrice: option.additionalPrice || "0",
                    });
                }
            }
        }
    }

    return SuccessResponse(res, { message: "Create food success", data: { id: foodId } }, 201);
};

// =============================================
// GET ALL Foods (with variations & options)
// =============================================
export const getAllFoods = async (req: Request, res: Response) => {
    // 1. جلب البيانات ككائنات منفصلة (لمنع تضارب الـ id وتجنب خطأ 500)
    const rawFoods = await db.select({
        foodObj: food,
        restaurantObj: restaurants,
        categoryObj: categories,
        subcategoryObj: subcategories,
    })
    .from(food)
    .leftJoin(restaurants, eq(food.restaurantid, restaurants.id))
    .leftJoin(categories, eq(food.categoryid, categories.id))
    .leftJoin(subcategories, eq(food.subcategoryid, subcategories.id));

    if (rawFoods.length === 0) return SuccessResponse(res, { message: "Get all foods success", data: [] });

    // 2. تجميع البيانات بشكل نظيف للـ Frontend
    const allFoods = rawFoods.map(row => ({
        ...row.foodObj,
        restaurant: row.restaurantObj ? { id: row.restaurantObj.id, name: row.restaurantObj.name } : null,
        category: row.categoryObj ? { id: row.categoryObj.id, name: row.categoryObj.name } : null,
        subcategory: row.subcategoryObj ? { id: row.subcategoryObj.id, name: row.subcategoryObj.name } : null,
    }));

    const foodIds = allFoods.map(f => f.id);

    // 3. جلب كل الـ Variations و الـ Options دفعة واحدة (أسرع بـ 100 مرة من الـ loop)
    const allVars = await db.select().from(foodVariations).where(inArray(foodVariations.foodId, foodIds));
    const varIds = allVars.map(v => v.id);
    const allOpts = varIds.length > 0 ? await db.select().from(variationOptions).where(inArray(variationOptions.variationId, varIds)) : [];

    // 4. دمج الـ Variations والـ Options مع الوجبات في الذاكرة
    const result = allFoods.map(f => {
        const foodVars = allVars.filter(v => v.foodId === f.id).map(v => ({
            ...v,
            options: allOpts.filter(o => o.variationId === v.id)
        }));
        return { ...f, variations: foodVars };
    });

    return SuccessResponse(res, { message: "Get all foods success", data: result });
};
// =============================================
// GET ALL Foods By Restaurant ID (with variations & options)
// =============================================
export const getFoodsByRestaurantId = async (req: Request, res: Response) => {
    const { id: restaurantId } = req.params;

    const allFoods = await db
        .select({
            id: food.id,
            name: food.name,
            description: food.description,
            image: food.image,
            restaurantid: food.restaurantid,
            categoryid: food.categoryid,
            subcategoryid: food.subcategoryid,
            foodtype: food.foodtype,
            Nutrition: food.Nutrition,
            Allegren_Ingredients: food.Allegren_Ingredients,
            is_Halal: food.is_Halal,
            addonsId: food.addonsId,
            startTime: food.startTime,
            endTime: food.endTime,
            search_tages: food.search_tages,
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
            },
            category: {
                id: categories.id,
                name: categories.name,
            },
            subcategory: {
                id: subcategories.id,
                name: subcategories.name,
            },
        })
        .from(food)
        .leftJoin(restaurants, eq(food.restaurantid, restaurants.id))
        .leftJoin(categories, eq(food.categoryid, categories.id))
        .leftJoin(subcategories, eq(food.subcategoryid, subcategories.id))
        .where(eq(food.restaurantid, restaurantId));

    // Attach variations + options to each food
    const result = await Promise.all(
        allFoods.map(async (f) => {
            const vars = await db.select().from(foodVariations).where(eq(foodVariations.foodId, f.id));
            const variationsWithOptions = await Promise.all(
                vars.map(async (v) => {
                    const opts = await db.select().from(variationOptions).where(eq(variationOptions.variationId, v.id));
                    return { ...v, options: opts };
                })
            );
            return { ...f, variations: variationsWithOptions };
        })
    );

    return SuccessResponse(res, { message: "Get foods by restaurant id success", data: result });
};

// =============================================
// GET Food by ID (with variations & options)
// =============================================
export const getFoodById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const foodItem = await db
        .select({
            id: food.id,
            name: food.name,
            description: food.description,
            image: food.image,
            restaurantid: food.restaurantid,
            categoryid: food.categoryid,
            subcategoryid: food.subcategoryid,
            foodtype: food.foodtype,
            Nutrition: food.Nutrition,
            Allegren_Ingredients: food.Allegren_Ingredients,
            is_Halal: food.is_Halal,
            addonsId: food.addonsId,
            startTime: food.startTime,
            endTime: food.endTime,
            search_tages: food.search_tages,
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
            },
            category: {
                id: categories.id,
                name: categories.name,
            },
            subcategory: {
                id: subcategories.id,
                name: subcategories.name,
            },
        })
        .from(food)
        .leftJoin(restaurants, eq(food.restaurantid, restaurants.id))
        .leftJoin(categories, eq(food.categoryid, categories.id))
        .leftJoin(subcategories, eq(food.subcategoryid, subcategories.id))
        .where(eq(food.id, id))
        .limit(1);

    if (!foodItem[0]) {
        throw new NotFound("Food not found");
    }

    // Get variations + options
    const vars = await db.select().from(foodVariations).where(eq(foodVariations.foodId, id));
    const variationsWithOptions = await Promise.all(
        vars.map(async (v) => {
            const opts = await db.select().from(variationOptions).where(eq(variationOptions.variationId, v.id));
            return { ...v, options: opts };
        })
    );

    return SuccessResponse(res, {
        message: "Get food by id success",
        data: { ...foodItem[0], variations: variationsWithOptions },
    });
};

// =============================================
// UPDATE Food + replace Variations & Options
// =============================================
export const updateFood = async (req: Request, res: Response) => {
    const { id } = req.params;
    const {
        name, description, image,
        restaurantid, categoryid, subcategoryid,
        foodtype, Nutrition, Allegren_Ingredients, is_Halal,
        addonsId, startTime, endTime, search_tages,
        price, discount_type, discount_value, Maximum_Purchase, stock_type,
        status,
        variations,
    } = req.body;

    // Check food exists
    const existingFood = await db.select().from(food).where(eq(food.id, id)).limit(1);
    if (!existingFood[0]) throw new NotFound("Food not found");

    // Validate FK's if provided
    if (restaurantid) {
        const r = await db.select().from(restaurants).where(eq(restaurants.id, restaurantid)).limit(1);
        if (!r[0]) throw new BadRequest("Restaurant not found");
    }
    if (categoryid) {
        const c = await db.select().from(categories).where(eq(categories.id, categoryid)).limit(1);
        if (!c[0]) throw new BadRequest("Category not found");
    }
    if (subcategoryid) {
        const s = await db.select().from(subcategories).where(eq(subcategories.id, subcategoryid)).limit(1);
        if (!s[0]) throw new BadRequest("Subcategory not found");
    }
    if (addonsId) {
        const a = await db.select().from(addons).where(eq(addons.id, addonsId)).limit(1);
        if (!a[0]) throw new BadRequest("Addon not found");
    }

    // Build update data
    const updateData: any = { updatedAt: new Date() };

    if (name) updateData.name = name;
    if (description) updateData.description = description;
    if (image) updateData.image = image;
    if (restaurantid) updateData.restaurantid = restaurantid;
    if (categoryid) updateData.categoryid = categoryid;
    if (subcategoryid) updateData.subcategoryid = subcategoryid;
    if (foodtype) updateData.foodtype = foodtype;
    if (Nutrition !== undefined) updateData.Nutrition = Nutrition;
    if (Allegren_Ingredients !== undefined) updateData.Allegren_Ingredients = Allegren_Ingredients;
    if (is_Halal !== undefined) updateData.is_Halal = is_Halal;
    if (addonsId !== undefined) updateData.addonsId = addonsId || null;
    if (startTime) updateData.startTime = startTime;
    if (endTime) updateData.endTime = endTime;
    if (search_tages !== undefined) updateData.search_tages = search_tages;
    if (price) updateData.price = price;
    if (discount_type) updateData.discount_type = discount_type;
    if (discount_value !== undefined) updateData.discount_value = discount_value;
    if (Maximum_Purchase !== undefined) updateData.Maximum_Purchase = Maximum_Purchase;
    if (stock_type) updateData.stock_type = stock_type;
    if (status) updateData.status = status;
    if (variations !== undefined) updateData.variations = variations; // update JSON snapshot

    await db.update(food).set(updateData).where(eq(food.id, id));

    // If variations are provided, delete old ones and insert new ones (replace strategy)
    if (variations !== undefined && Array.isArray(variations)) {
        // Get old variations to delete their options first
        const oldVars = await db.select().from(foodVariations).where(eq(foodVariations.foodId, id));
        for (const ov of oldVars) {
            await db.delete(variationOptions).where(eq(variationOptions.variationId, ov.id));
        }
        await db.delete(foodVariations).where(eq(foodVariations.foodId, id));

        // Insert new variations & options
        for (const variation of variations) {
            const variationId = uuidv4();

            await db.insert(foodVariations).values({
                id: variationId,
                foodId: id,
                name: variation.name,
                isRequired: variation.isRequired || false,
                selectionType: variation.selectionType || "single",
                min: variation.min || null,
                max: variation.max || null,
            });

            if (variation.options && Array.isArray(variation.options) && variation.options.length > 0) {
                for (const option of variation.options) {
                    await db.insert(variationOptions).values({
                        id: uuidv4(),
                        variationId,
                        optionName: option.optionName,
                        additionalPrice: option.additionalPrice || "0",
                    });
                }
            }
        }
    }

    return SuccessResponse(res, { message: "Update food success" });
};

// =============================================
// DELETE Food (cascade handles variations & options)
// =============================================
export const deleteFood = async (req: Request, res: Response) => {
    const { id } = req.params;

    const existingFood = await db.select().from(food).where(eq(food.id, id)).limit(1);
    if (!existingFood[0]) throw new NotFound("Food not found");

    // Delete options -> variations -> food (manual cascade for safety)
    const vars = await db.select().from(foodVariations).where(eq(foodVariations.foodId, id));
    for (const v of vars) {
        await db.delete(variationOptions).where(eq(variationOptions.variationId, v.id));
    }
    await db.delete(foodVariations).where(eq(foodVariations.foodId, id));
    await db.delete(food).where(eq(food.id, id));

    return SuccessResponse(res, { message: "Delete food success" });
};

// =============================================
// SELECT data for food form dropdowns
// =============================================
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
        .select({ id: subcategories.id, name: subcategories.name, categoryId: subcategories.categoryId })
        .from(subcategories)
        .where(eq(subcategories.status, "active"));

    const allAddons = await db
        .select({ id: addons.id, name: addons.name })
        .from(addons)
        .where(eq(addons.status, "active"));

    return SuccessResponse(res, {
        message: "Get food select data success",
        data: { allRestaurants, allCategories, allSubcategories, allAddons },
    });
};
