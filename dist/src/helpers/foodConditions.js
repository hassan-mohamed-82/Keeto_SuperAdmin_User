"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activeFoodCondition = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const food_1 = require("../models/schema/admin/food");
exports.activeFoodCondition = (0, drizzle_orm_1.isNull)(food_1.food.deletedAt);
