"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFoodSelectData = exports.getFoodsByRestaurantId = exports.deleteFood = exports.updateFood = exports.getFoodById = exports.getAllFoods = exports.createFood = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const NotFound_1 = require("../../Errors/NotFound");
const BadRequest_1 = require("../../Errors/BadRequest");
const uuid_1 = require("uuid");
const handleImages_1 = require("../../utils/handleImages");
// =============================================
// CREATE Food
// =============================================
const createFood = async (req, res) => {
    const { name, nameAr, nameFr, description, descriptionAr, descriptionFr, image, restaurantid, categoryid, subcategoryid, foodtype, Nutrition, allergen_ingredients, is_Halal, addonsId, startTime, endTime, search_tags, price, discount_type, discount_value, Maximum_Purchase, stock_type, status, variations, } = req.body;
    if (!name || !nameAr || !nameFr || !description || !descriptionAr || !descriptionFr || !image || !categoryid || !subcategoryid || !startTime || !endTime || !price) {
        throw new BadRequest_1.BadRequest("Missing required fields");
    }
    const existingRestaurant = await connection_1.db.select().from(schema_1.restaurants).where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantid)).limit(1);
    if (!existingRestaurant[0])
        throw new BadRequest_1.BadRequest("Restaurant not found");
    const existingCategory = await connection_1.db.select().from(schema_1.categories).where((0, drizzle_orm_1.eq)(schema_1.categories.id, categoryid)).limit(1);
    if (!existingCategory[0])
        throw new BadRequest_1.BadRequest("Category not found");
    const existingSub = await connection_1.db.select().from(schema_1.subcategories).where((0, drizzle_orm_1.eq)(schema_1.subcategories.id, subcategoryid)).limit(1);
    if (!existingSub[0])
        throw new BadRequest_1.BadRequest("Subcategory not found");
    if (addonsId) {
        const existingAddon = await connection_1.db.select().from(schema_1.addons).where((0, drizzle_orm_1.eq)(schema_1.addons.id, addonsId)).limit(1);
        if (!existingAddon[0])
            throw new BadRequest_1.BadRequest("Addon not found");
    }
    let imageUrl = undefined;
    if (image) {
        const result = await (0, handleImages_1.saveBase64Image)(req, image, "basiccampaign");
        imageUrl = result.url;
    }
    const foodId = (0, uuid_1.v4)();
    await connection_1.db.insert(schema_1.food).values({
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
            const variationId = (0, uuid_1.v4)();
            if (!variation.nameAr || !variation.nameFr)
                throw new BadRequest_1.BadRequest("Variation nameAr, nameFr are required");
            await connection_1.db.insert(schema_1.foodVariations).values({
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
                    if (!option.optionNameAr || !option.optionNameFr)
                        throw new BadRequest_1.BadRequest("Option optionNameAr, optionNameFr are required");
                    await connection_1.db.insert(schema_1.variationOptions).values({
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
    return (0, response_1.SuccessResponse)(res, { message: "Create food success", data: { id: foodId } }, 201);
};
exports.createFood = createFood;
// =============================================
// GET ALL Foods (Optimized)
// =============================================
const getAllFoods = async (req, res) => {
    const rawFoods = await connection_1.db.select({
        // ✅ Food fields
        id: schema_1.food.id,
        name: schema_1.food.name,
        nameAr: schema_1.food.nameAr,
        nameFr: schema_1.food.nameFr,
        description: schema_1.food.description,
        descriptionAr: schema_1.food.descriptionAr,
        descriptionFr: schema_1.food.descriptionFr,
        image: schema_1.food.image,
        restaurantid: schema_1.food.restaurantid,
        categoryid: schema_1.food.categoryid,
        subcategoryid: schema_1.food.subcategoryid,
        foodtype: schema_1.food.foodtype,
        Nutrition: schema_1.food.Nutrition,
        allergen_ingredients: schema_1.food.allergen_ingredients,
        is_Halal: schema_1.food.is_Halal,
        addonsId: schema_1.food.addonsId,
        startTime: schema_1.food.startTime,
        endTime: schema_1.food.endTime,
        search_tags: schema_1.food.search_tags,
        price: schema_1.food.price,
        discount_type: schema_1.food.discount_type,
        discount_value: schema_1.food.discount_value,
        Maximum_Purchase: schema_1.food.Maximum_Purchase,
        stock_type: schema_1.food.stock_type,
        status: schema_1.food.status,
        createdAt: schema_1.food.createdAt,
        updatedAt: schema_1.food.updatedAt,
        // ✅ Restaurant (alias مهم)
        restaurant_id: schema_1.restaurants.id,
        restaurant_name: schema_1.restaurants.name,
        restaurant_nameAr: schema_1.restaurants.nameAr,
        restaurant_nameFr: schema_1.restaurants.nameFr,
        // ✅ Category
        category_name: schema_1.categories.name,
        category_nameAr: schema_1.categories.nameAr,
        category_nameFr: schema_1.categories.nameFr,
        // ✅ Subcategory
        subcategory_name: schema_1.subcategories.name,
        subcategory_nameAr: schema_1.subcategories.nameAr,
        subcategory_nameFr: schema_1.subcategories.nameFr,
    })
        .from(schema_1.food)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.food.restaurantid, schema_1.restaurants.id))
        .leftJoin(schema_1.categories, (0, drizzle_orm_1.eq)(schema_1.food.categoryid, schema_1.categories.id))
        .leftJoin(schema_1.subcategories, (0, drizzle_orm_1.eq)(schema_1.food.subcategoryid, schema_1.subcategories.id));
    if (rawFoods.length === 0) {
        return (0, response_1.SuccessResponse)(res, { message: "Get all foods success", data: [] });
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
    return (0, response_1.SuccessResponse)(res, {
        message: "Get all foods success",
        data: allFoods
    });
};
exports.getAllFoods = getAllFoods;
// =============================================
// GET Food By ID (FIXED SELECT)
// =============================================
const getFoodById = async (req, res) => {
    const { id } = req.params;
    const foodItem = await connection_1.db.select({
        id: schema_1.food.id,
        name: schema_1.food.name,
        nameAr: schema_1.food.nameAr,
        nameFr: schema_1.food.nameFr,
        description: schema_1.food.description,
        descriptionAr: schema_1.food.descriptionAr,
        descriptionFr: schema_1.food.descriptionFr,
        image: schema_1.food.image,
        restaurantid: schema_1.food.restaurantid,
        categoryid: schema_1.food.categoryid,
        subcategoryid: schema_1.food.subcategoryid,
        foodtype: schema_1.food.foodtype,
        Nutrition: schema_1.food.Nutrition,
        allergen_ingredients: schema_1.food.allergen_ingredients,
        is_Halal: schema_1.food.is_Halal,
        addonsId: schema_1.food.addonsId,
        startTime: schema_1.food.startTime,
        endTime: schema_1.food.endTime,
        search_tags: schema_1.food.search_tags,
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
            nameAr: schema_1.restaurants.nameAr,
            nameFr: schema_1.restaurants.nameFr,
        },
        category: {
            id: schema_1.categories.id,
            name: schema_1.categories.name,
            nameAr: schema_1.categories.nameAr,
            nameFr: schema_1.categories.nameFr,
        },
        subcategory: {
            id: schema_1.subcategories.id,
            name: schema_1.subcategories.name,
            nameAr: schema_1.subcategories.nameAr,
            nameFr: schema_1.subcategories.nameFr,
        },
    })
        .from(schema_1.food)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.food.restaurantid, schema_1.restaurants.id))
        .leftJoin(schema_1.categories, (0, drizzle_orm_1.eq)(schema_1.food.categoryid, schema_1.categories.id))
        .leftJoin(schema_1.subcategories, (0, drizzle_orm_1.eq)(schema_1.food.subcategoryid, schema_1.subcategories.id))
        .where((0, drizzle_orm_1.eq)(schema_1.food.id, id))
        .limit(1);
    if (!foodItem[0])
        throw new NotFound_1.NotFound("Food not found");
    const vars = await connection_1.db.select().from(schema_1.foodVariations).where((0, drizzle_orm_1.eq)(schema_1.foodVariations.foodId, id));
    const varIds = vars.map(v => v.id);
    const opts = varIds.length
        ? await connection_1.db.select().from(schema_1.variationOptions).where((0, drizzle_orm_1.inArray)(schema_1.variationOptions.variationId, varIds))
        : [];
    const variations = vars.map(v => ({
        ...v,
        options: opts.filter(o => o.variationId === v.id)
    }));
    return (0, response_1.SuccessResponse)(res, {
        message: "Get food by id success",
        data: { ...foodItem[0], variations }
    });
};
exports.getFoodById = getFoodById;
// =============================================
// UPDATE Food
// =============================================
const updateFood = async (req, res) => {
    const { id } = req.params;
    const data = req.body;
    const existingFood = await connection_1.db.select().from(schema_1.food).where((0, drizzle_orm_1.eq)(schema_1.food.id, id)).limit(1);
    if (!existingFood[0])
        throw new NotFound_1.NotFound("Food not found");
    const updateData = { updatedAt: new Date() };
    Object.keys(data).forEach(key => {
        if (key !== 'variations') {
            updateData[key] = data[key];
        }
    });
    await connection_1.db.update(schema_1.food).set(updateData).where((0, drizzle_orm_1.eq)(schema_1.food.id, id));
    if (data.variations && Array.isArray(data.variations)) {
        const oldVars = await connection_1.db.select().from(schema_1.foodVariations).where((0, drizzle_orm_1.eq)(schema_1.foodVariations.foodId, id));
        for (const v of oldVars) {
            await connection_1.db.delete(schema_1.variationOptions).where((0, drizzle_orm_1.eq)(schema_1.variationOptions.variationId, v.id));
        }
        await connection_1.db.delete(schema_1.foodVariations).where((0, drizzle_orm_1.eq)(schema_1.foodVariations.foodId, id));
        for (const variation of data.variations) {
            const variationId = (0, uuid_1.v4)();
            if (!variation.nameAr || !variation.nameFr)
                throw new BadRequest_1.BadRequest("Variation nameAr, nameFr are required");
            await connection_1.db.insert(schema_1.foodVariations).values({
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
                    if (!option.optionNameAr || !option.optionNameFr)
                        throw new BadRequest_1.BadRequest("Option optionNameAr, optionNameFr are required");
                    await connection_1.db.insert(schema_1.variationOptions).values({
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
    return (0, response_1.SuccessResponse)(res, { message: "Update food success" });
};
exports.updateFood = updateFood;
// =============================================
// DELETE Food
// =============================================
const deleteFood = async (req, res) => {
    const { id } = req.params;
    const existingFood = await connection_1.db.select().from(schema_1.food).where((0, drizzle_orm_1.eq)(schema_1.food.id, id)).limit(1);
    if (!existingFood[0])
        throw new NotFound_1.NotFound("Food not found");
    const vars = await connection_1.db.select().from(schema_1.foodVariations).where((0, drizzle_orm_1.eq)(schema_1.foodVariations.foodId, id));
    for (const v of vars) {
        await connection_1.db.delete(schema_1.variationOptions).where((0, drizzle_orm_1.eq)(schema_1.variationOptions.variationId, v.id));
    }
    await connection_1.db.delete(schema_1.foodVariations).where((0, drizzle_orm_1.eq)(schema_1.foodVariations.foodId, id));
    await connection_1.db.delete(schema_1.food).where((0, drizzle_orm_1.eq)(schema_1.food.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Delete food success" });
};
exports.deleteFood = deleteFood;
const getFoodsByRestaurantId = async (req, res) => {
    const { id: restaurantId } = req.params;
    const foods = await connection_1.db.select({
        foodObj: schema_1.food,
        restaurantObj: schema_1.restaurants,
        categoryObj: schema_1.categories,
        subcategoryObj: schema_1.subcategories,
    })
        .from(schema_1.food)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.food.restaurantid, schema_1.restaurants.id))
        .leftJoin(schema_1.categories, (0, drizzle_orm_1.eq)(schema_1.food.categoryid, schema_1.categories.id))
        .leftJoin(schema_1.subcategories, (0, drizzle_orm_1.eq)(schema_1.food.subcategoryid, schema_1.subcategories.id))
        .where((0, drizzle_orm_1.eq)(schema_1.food.restaurantid, restaurantId));
    if (foods.length === 0) {
        return (0, response_1.SuccessResponse)(res, { message: "No foods found", data: [] });
    }
    const formatted = foods.map(row => ({
        ...row.foodObj,
        restaurant: row.restaurantObj ? { id: row.restaurantObj.id, name: row.restaurantObj.name } : null,
        category: row.categoryObj ? { id: row.categoryObj.id, name: row.categoryObj.name } : null,
        subcategory: row.subcategoryObj ? { id: row.subcategoryObj.id, name: row.subcategoryObj.name } : null,
    }));
    const foodIds = formatted.map(f => f.id);
    const vars = await connection_1.db.select().from(schema_1.foodVariations).where((0, drizzle_orm_1.inArray)(schema_1.foodVariations.foodId, foodIds));
    const varIds = vars.map(v => v.id);
    const opts = varIds.length
        ? await connection_1.db.select().from(schema_1.variationOptions).where((0, drizzle_orm_1.inArray)(schema_1.variationOptions.variationId, varIds))
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
    return (0, response_1.SuccessResponse)(res, { message: "Get foods by restaurant id success", data: result });
};
exports.getFoodsByRestaurantId = getFoodsByRestaurantId;
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
        .select({
        id: schema_1.subcategories.id,
        name: schema_1.subcategories.name,
        categoryId: schema_1.subcategories.categoryId
    })
        .from(schema_1.subcategories)
        .where((0, drizzle_orm_1.eq)(schema_1.subcategories.status, "active"));
    const allAddons = await connection_1.db
        .select({ id: schema_1.addons.id, name: schema_1.addons.name })
        .from(schema_1.addons)
        .where((0, drizzle_orm_1.eq)(schema_1.addons.status, "active"));
    return (0, response_1.SuccessResponse)(res, {
        message: "Get food select data success",
        data: {
            allRestaurants,
            allCategories,
            allSubcategories,
            allAddons
        }
    });
};
exports.getFoodSelectData = getFoodSelectData;
