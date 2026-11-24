import { eq } from "drizzle-orm";
import { food } from "../models/schema/admin/food";
import { categories } from "../models/schema/admin/Category";
import { subcategories } from "../models/schema/admin/subcategory";

// Soft-delete filters: use these in every read that should hide trashed rows.
export const activeFoodCondition = eq(food.isDeleted, false);
export const activeCategoryCondition = eq(categories.isDeleted, false);
export const activeSubcategoryCondition = eq(subcategories.isDeleted, false);
