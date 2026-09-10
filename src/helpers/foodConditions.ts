import { isNull } from "drizzle-orm";
import { food } from "../models/schema/admin/food";

export const activeFoodCondition = isNull(food.deletedAt);
