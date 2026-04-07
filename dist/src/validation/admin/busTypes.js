"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateBusTypeSchema = exports.createBusTypeSchema = void 0;
const zod_1 = __importDefault(require("zod"));
exports.createBusTypeSchema = zod_1.default.object({
    body: zod_1.default.object({
        name: zod_1.default.string().min(1, "Name is required").max(100, "Name is too long"),
        capacity: zod_1.default.number().min(1, "Capacity must be at least 1"),
        description: zod_1.default.string().max(255).optional(),
    }),
});
exports.updateBusTypeSchema = zod_1.default.object({
    params: zod_1.default.object({
        Id: zod_1.default.string().uuid("Invalid Bus Type ID"),
    }),
    body: zod_1.default.object({
        name: zod_1.default.string().min(1, "Name is required").max(100, "Name is too long").optional(),
        capacity: zod_1.default.number().min(1, "Capacity must be at least 1").optional(),
        description: zod_1.default.string().max(255).optional(),
        status: zod_1.default.enum(["active", "inactive"]).optional(),
    }),
});
