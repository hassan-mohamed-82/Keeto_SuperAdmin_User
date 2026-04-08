"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFoodSelectData = exports.deleteFood = exports.updateFood = exports.getFoodById = exports.getAllFoods = exports.createFood = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const NotFound_1 = require("../../Errors/NotFound");
const BadRequest_1 = require("../../Errors/BadRequest");
const uuid_1 = require("uuid");
// =============================================
// CREATE Food + Variations + Options in one API
// =============================================
const createFood = async (req, res) => {
    const { name, description, image, restaurantid, categoryid, subcategoryid, foodtype, Nutrition, Allegren_Ingredients, is_Halal, addonsId, startTime, endTime, search_tages, price, discount_type, discount_value, Maximum_Purchase, stock_type, status, variations, // Array of { name, isRequired, selectionType, min, max, options: [{ optionName, additionalPrice }] }
     } = req.body;
    // Required fields
    if (!name || !description || !image || !restaurantid || !categoryid || !subcategoryid || !startTime || !endTime || !price) {
        throw new BadRequest_1.BadRequest("Missing required fields: name, description, image, restaurantid, categoryid, subcategoryid, startTime, endTime, price");
    }
    // Validate restaurant
    const existingRestaurant = await connection_1.db.select().from(schema_1.restaurants).where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantid)).limit(1);
    if (!existingRestaurant[0])
        throw new BadRequest_1.BadRequest("Restaurant not found");
    // Validate category
    const existingCategory = await connection_1.db.select().from(schema_1.categories).where((0, drizzle_orm_1.eq)(schema_1.categories.id, categoryid)).limit(1);
    if (!existingCategory[0])
        throw new BadRequest_1.BadRequest("Category not found");
    // Validate subcategory
    const existingSub = await connection_1.db.select().from(schema_1.subcategories).where((0, drizzle_orm_1.eq)(schema_1.subcategories.id, subcategoryid)).limit(1);
    if (!existingSub[0])
        throw new BadRequest_1.BadRequest("Subcategory not found");
    // Validate addon if provided
    if (addonsId) {
        const existingAddon = await connection_1.db.select().from(schema_1.addons).where((0, drizzle_orm_1.eq)(schema_1.addons.id, addonsId)).limit(1);
        if (!existingAddon[0])
            throw new BadRequest_1.BadRequest("Addon not found");
    }
    const foodId = (0, uuid_1.v4)();
    // 1. Insert food
    await connection_1.db.insert(schema_1.food).values({
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
            const variationId = (0, uuid_1.v4)();
            await connection_1.db.insert(schema_1.foodVariations).values({
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
                    await connection_1.db.insert(schema_1.variationOptions).values({
                        id: (0, uuid_1.v4)(),
                        variationId,
                        optionName: option.optionName,
                        additionalPrice: option.additionalPrice || "0",
                    });
                }
            }
        }
    }
    return (0, response_1.SuccessResponse)(res, { message: "Create food success", data: { id: foodId } }, 201);
};
exports.createFood = createFood;
// =============================================
// GET ALL Foods (with variations & options)
// =============================================
const getAllFoods = async (req, res) => {
    const allFoods = await connection_1.db
        .select({
        id: schema_1.food.id,
        name: schema_1.food.name,
        description: schema_1.food.description,
        image: schema_1.food.image,
        restaurantid: schema_1.food.restaurantid,
        categoryid: schema_1.food.categoryid,
        subcategoryid: schema_1.food.subcategoryid,
        foodtype: schema_1.food.foodtype,
        Nutrition: schema_1.food.Nutrition,
        Allegren_Ingredients: schema_1.food.Allegren_Ingredients,
        is_Halal: schema_1.food.is_Halal,
        addonsId: schema_1.food.addonsId,
        startTime: schema_1.food.startTime,
        endTime: schema_1.food.endTime,
        search_tages: schema_1.food.search_tages,
        price: schema_1.food.price,
        discount_type: schema_1.food.discount_type,
        discount_value: schema_1.food.discount_value,
        Maximum_Purchase: schema_1.food.Maximum_Purchase,
        stock_type: schema_1.food.stock_type,
        status: schema_1.food.status,
        createdAt: schema_1.food.createdAt,
        updatedAt: schema_1.food.updatedAt,
        restaurant: {
            id: schema_1.restaurants.id,
            name: schema_1.restaurants.name,
        },
        category: {
            id: schema_1.categories.id,
            name: schema_1.categories.name,
        },
        subcategory: {
            id: schema_1.subcategories.id,
            name: schema_1.subcategories.name,
        },
    })
        .from(schema_1.food)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.food.restaurantid, schema_1.restaurants.id))
        .leftJoin(schema_1.categories, (0, drizzle_orm_1.eq)(schema_1.food.categoryid, schema_1.categories.id))
        .leftJoin(schema_1.subcategories, (0, drizzle_orm_1.eq)(schema_1.food.subcategoryid, schema_1.subcategories.id));
    // Attach variations + options to each food
    const result = await Promise.all(allFoods.map(async (f) => {
        const vars = await connection_1.db.select().from(schema_1.foodVariations).where((0, drizzle_orm_1.eq)(schema_1.foodVariations.foodId, f.id));
        const variationsWithOptions = await Promise.all(vars.map(async (v) => {
            const opts = await connection_1.db.select().from(schema_1.variationOptions).where((0, drizzle_orm_1.eq)(schema_1.variationOptions.variationId, v.id));
            return { ...v, options: opts };
        }));
        return { ...f, variations: variationsWithOptions };
    }));
    return (0, response_1.SuccessResponse)(res, { message: "Get all foods success", data: result });
};
exports.getAllFoods = getAllFoods;
// =============================================
// GET Food by ID (with variations & options)
// =============================================
const getFoodById = async (req, res) => {
    const { id } = req.params;
    const foodItem = await connection_1.db
        .select({
        id: schema_1.food.id,
        name: schema_1.food.name,
        description: schema_1.food.description,
        image: schema_1.food.image,
        restaurantid: schema_1.food.restaurantid,
        categoryid: schema_1.food.categoryid,
        subcategoryid: schema_1.food.subcategoryid,
        foodtype: schema_1.food.foodtype,
        Nutrition: schema_1.food.Nutrition,
        Allegren_Ingredients: schema_1.food.Allegren_Ingredients,
        is_Halal: schema_1.food.is_Halal,
        addonsId: schema_1.food.addonsId,
        startTime: schema_1.food.startTime,
        endTime: schema_1.food.endTime,
        search_tages: schema_1.food.search_tages,
        price: schema_1.food.price,
        discount_type: schema_1.food.discount_type,
        discount_value: schema_1.food.discount_value,
        Maximum_Purchase: schema_1.food.Maximum_Purchase,
        stock_type: schema_1.food.stock_type,
        status: schema_1.food.status,
        createdAt: schema_1.food.createdAt,
        updatedAt: schema_1.food.updatedAt,
        restaurant: {
            id: schema_1.restaurants.id,
            name: schema_1.restaurants.name,
        },
        category: {
            id: schema_1.categories.id,
            name: schema_1.categories.name,
        },
        subcategory: {
            id: schema_1.subcategories.id,
            name: schema_1.subcategories.name,
        },
    })
        .from(schema_1.food)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.food.restaurantid, schema_1.restaurants.id))
        .leftJoin(schema_1.categories, (0, drizzle_orm_1.eq)(schema_1.food.categoryid, schema_1.categories.id))
        .leftJoin(schema_1.subcategories, (0, drizzle_orm_1.eq)(schema_1.food.subcategoryid, schema_1.subcategories.id))
        .where((0, drizzle_orm_1.eq)(schema_1.food.id, id))
        .limit(1);
    if (!foodItem[0]) {
        throw new NotFound_1.NotFound("Food not found");
    }
    // Get variations + options
    const vars = await connection_1.db.select().from(schema_1.foodVariations).where((0, drizzle_orm_1.eq)(schema_1.foodVariations.foodId, id));
    const variationsWithOptions = await Promise.all(vars.map(async (v) => {
        const opts = await connection_1.db.select().from(schema_1.variationOptions).where((0, drizzle_orm_1.eq)(schema_1.variationOptions.variationId, v.id));
        return { ...v, options: opts };
    }));
    return (0, response_1.SuccessResponse)(res, {
        message: "Get food by id success",
        data: { ...foodItem[0], variations: variationsWithOptions },
    });
};
exports.getFoodById = getFoodById;
// =============================================
// UPDATE Food + replace Variations & Options
// =============================================
const updateFood = async (req, res) => {
    const { id } = req.params;
    const { name, description, image, restaurantid, categoryid, subcategoryid, foodtype, Nutrition, Allegren_Ingredients, is_Halal, addonsId, startTime, endTime, search_tages, price, discount_type, discount_value, Maximum_Purchase, stock_type, status, variations, } = req.body;
    // Check food exists
    const existingFood = await connection_1.db.select().from(schema_1.food).where((0, drizzle_orm_1.eq)(schema_1.food.id, id)).limit(1);
    if (!existingFood[0])
        throw new NotFound_1.NotFound("Food not found");
    // Validate FK's if provided
    if (restaurantid) {
        const r = await connection_1.db.select().from(schema_1.restaurants).where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantid)).limit(1);
        if (!r[0])
            throw new BadRequest_1.BadRequest("Restaurant not found");
    }
    if (categoryid) {
        const c = await connection_1.db.select().from(schema_1.categories).where((0, drizzle_orm_1.eq)(schema_1.categories.id, categoryid)).limit(1);
        if (!c[0])
            throw new BadRequest_1.BadRequest("Category not found");
    }
    if (subcategoryid) {
        const s = await connection_1.db.select().from(schema_1.subcategories).where((0, drizzle_orm_1.eq)(schema_1.subcategories.id, subcategoryid)).limit(1);
        if (!s[0])
            throw new BadRequest_1.BadRequest("Subcategory not found");
    }
    if (addonsId) {
        const a = await connection_1.db.select().from(schema_1.addons).where((0, drizzle_orm_1.eq)(schema_1.addons.id, addonsId)).limit(1);
        if (!a[0])
            throw new BadRequest_1.BadRequest("Addon not found");
    }
    // Build update data
    const updateData = { updatedAt: new Date() };
    if (name)
        updateData.name = name;
    if (description)
        updateData.description = description;
    if (image)
        updateData.image = image;
    if (restaurantid)
        updateData.restaurantid = restaurantid;
    if (categoryid)
        updateData.categoryid = categoryid;
    if (subcategoryid)
        updateData.subcategoryid = subcategoryid;
    if (foodtype)
        updateData.foodtype = foodtype;
    if (Nutrition !== undefined)
        updateData.Nutrition = Nutrition;
    if (Allegren_Ingredients !== undefined)
        updateData.Allegren_Ingredients = Allegren_Ingredients;
    if (is_Halal !== undefined)
        updateData.is_Halal = is_Halal;
    if (addonsId !== undefined)
        updateData.addonsId = addonsId || null;
    if (startTime)
        updateData.startTime = startTime;
    if (endTime)
        updateData.endTime = endTime;
    if (search_tages !== undefined)
        updateData.search_tages = search_tages;
    if (price)
        updateData.price = price;
    if (discount_type)
        updateData.discount_type = discount_type;
    if (discount_value !== undefined)
        updateData.discount_value = discount_value;
    if (Maximum_Purchase !== undefined)
        updateData.Maximum_Purchase = Maximum_Purchase;
    if (stock_type)
        updateData.stock_type = stock_type;
    if (status)
        updateData.status = status;
    if (variations !== undefined)
        updateData.variations = variations; // update JSON snapshot
    await connection_1.db.update(schema_1.food).set(updateData).where((0, drizzle_orm_1.eq)(schema_1.food.id, id));
    // If variations are provided, delete old ones and insert new ones (replace strategy)
    if (variations !== undefined && Array.isArray(variations)) {
        // Get old variations to delete their options first
        const oldVars = await connection_1.db.select().from(schema_1.foodVariations).where((0, drizzle_orm_1.eq)(schema_1.foodVariations.foodId, id));
        for (const ov of oldVars) {
            await connection_1.db.delete(schema_1.variationOptions).where((0, drizzle_orm_1.eq)(schema_1.variationOptions.variationId, ov.id));
        }
        await connection_1.db.delete(schema_1.foodVariations).where((0, drizzle_orm_1.eq)(schema_1.foodVariations.foodId, id));
        // Insert new variations & options
        for (const variation of variations) {
            const variationId = (0, uuid_1.v4)();
            await connection_1.db.insert(schema_1.foodVariations).values({
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
                    await connection_1.db.insert(schema_1.variationOptions).values({
                        id: (0, uuid_1.v4)(),
                        variationId,
                        optionName: option.optionName,
                        additionalPrice: option.additionalPrice || "0",
                    });
                }
            }
        }
    }
    return (0, response_1.SuccessResponse)(res, { message: "Update food success" });
};
exports.updateFood = updateFood;
// =============================================
// DELETE Food (cascade handles variations & options)
// =============================================
const deleteFood = async (req, res) => {
    const { id } = req.params;
    const existingFood = await connection_1.db.select().from(schema_1.food).where((0, drizzle_orm_1.eq)(schema_1.food.id, id)).limit(1);
    if (!existingFood[0])
        throw new NotFound_1.NotFound("Food not found");
    // Delete options -> variations -> food (manual cascade for safety)
    const vars = await connection_1.db.select().from(schema_1.foodVariations).where((0, drizzle_orm_1.eq)(schema_1.foodVariations.foodId, id));
    for (const v of vars) {
        await connection_1.db.delete(schema_1.variationOptions).where((0, drizzle_orm_1.eq)(schema_1.variationOptions.variationId, v.id));
    }
    await connection_1.db.delete(schema_1.foodVariations).where((0, drizzle_orm_1.eq)(schema_1.foodVariations.foodId, id));
    await connection_1.db.delete(schema_1.food).where((0, drizzle_orm_1.eq)(schema_1.food.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Delete food success" });
};
exports.deleteFood = deleteFood;
// =============================================
// SELECT data for food form dropdowns
// =============================================
const getFoodSelectData = async (req, res) => {
    const allRestaurants = await connection_1.db
        .select({ id: schema_1.restaurants.id, name: schema_1.restaurants.name })
        .from(schema_1.restaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.status, "active"));
    const allCategories = await connection_1.db
        .select({ id: schema_1.categories.id, name: schema_1.categories.name })
        .from(schema_1.categories)
        .where((0, drizzle_orm_1.eq)(schema_1.categories.status, "active"));
    const allSubcategories = await connection_1.db
        .select({ id: schema_1.subcategories.id, name: schema_1.subcategories.name, categoryId: schema_1.subcategories.categoryId })
        .from(schema_1.subcategories)
        .where((0, drizzle_orm_1.eq)(schema_1.subcategories.status, "active"));
    const allAddons = await connection_1.db
        .select({ id: schema_1.addons.id, name: schema_1.addons.name })
        .from(schema_1.addons)
        .where((0, drizzle_orm_1.eq)(schema_1.addons.status, "active"));
    return (0, response_1.SuccessResponse)(res, {
        message: "Get food select data success",
        data: { allRestaurants, allCategories, allSubcategories, allAddons },
    });
};
exports.getFoodSelectData = getFoodSelectData;
