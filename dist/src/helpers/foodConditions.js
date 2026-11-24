"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activeSubcategoryCondition = exports.activeCategoryCondition = exports.activeFoodCondition = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const food_1 = require("../models/schema/admin/food");
const Category_1 = require("../models/schema/admin/Category");
const subcategory_1 = require("../models/schema/admin/subcategory");
// Soft-delete filters: use these in every read that should hide trashed rows.
exports.activeFoodCondition = (0, drizzle_orm_1.eq)(food_1.food.isDeleted, false);
exports.activeCategoryCondition = (0, drizzle_orm_1.eq)(Category_1.categories.isDeleted, false);
exports.activeSubcategoryCondition = (0, drizzle_orm_1.eq)(subcategory_1.subcategories.isDeleted, false);
